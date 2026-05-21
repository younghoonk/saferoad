#!/usr/bin/env node
/**
 * Phase 2-B' RAG 재가공 스크립트
 *
 * FSS 분쟁조정결정례 100건 + KOICD 법원판례 150건 = 250건
 * FSS/KOICD 분기 처리, 형식 검증, 재시도, 샘플 확인 모드 포함
 *
 * 사용법:
 *   node scripts/phase2b_reprocess.js --sample          # FSS 1건 + KOICD 1건 샘플만
 *   node scripts/phase2b_reprocess.js                   # 전체 실행
 *   node scripts/phase2b_reprocess.js --limit 10        # 10건만
 *   node scripts/phase2b_reprocess.js --source fss      # FSS만
 *   node scripts/phase2b_reprocess.js --source koicd    # KOICD만
 *   node scripts/phase2b_reprocess.js --select-only     # 후보 선별만
 *   node scripts/phase2b_reprocess.js --embed-only      # 임베딩만
 *   node scripts/phase2b_reprocess.js --dry-run         # DB 반영 없이 진행
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OAI_KEY = process.env.OPENAI_API_KEY;

const AUDIT_DIR = path.resolve(process.cwd(), 'audit');
const CANDIDATES_PATH = path.join(AUDIT_DIR, 'phase2b_candidates_v3.json');
const PROGRESS_PATH = path.join(AUDIT_DIR, 'phase2b_progress.json');
const SAMPLES_PATH = path.join(AUDIT_DIR, 'phase2b_samples.md');
const FORMAT_FAILURES_PATH = path.join(AUDIT_DIR, 'phase2b_format_failures.md');
const LOG_PATH = path.join(AUDIT_DIR, 'phase2b_run.log');
const BACKUP_DIR = path.join(process.cwd(), 'data_sources', 'phase2b_backup_before');
const FSS_TXT_DIR = path.join(process.cwd(), 'fss_dispute_cases_processed_v1', 'extracted_text');

const GPT_MODEL = 'gpt-4o';
const EMBED_MODEL = 'text-embedding-3-small';
const COST_LIMIT = 40;
const MAX_INPUT_CHARS = 10000; // 20k 초과 본문 잘라냄
const FORMAT_FAIL_RATE_LIMIT = 0.20;
const DELAY_BETWEEN_CALLS = 800;
const MAX_FORMAT_RETRIES = 2;

// ─────────────────────────── 카테고리 키워드 ───────────────────────────
const CATEGORY_KEYWORDS = {
  heart: ['심근경색','협심증','심장','심혈관','CAG','PCI','NSTEMI','STEMI','부정맥','I21','I25','관상동맥','허혈성심장','심부전','심장질환','급성심장','심장마비'],
  brain: ['뇌졸중','뇌출혈','뇌경색','뇌혈관','뇌허혈','I60','I61','I63','G45','지주막하','경동맥','뇌동맥','일과성뇌','뇌혈전','뇌손상'],
  cancer: ['암','암진단','갑상선암','유방암','위암','폐암','간암','경계성','제자리암','악성','종양','진단비','선암','육종','림프종','혈액암','직장암','대장암','자궁암'],
  disability: ['후유장해','후유 장해','장해분류','장해율','지급률','기왕장해','장해등급','노동능력','신체장해','후유증','노동상실'],
  silson: ['실손','입원치료','입원의료비','비급여','치료비','약제비','입원비','입원보험금','의료비','진료비','수술비','통원치료','본인부담금'],
};

function matchCategory(text) {
  const t = (text || '').toLowerCase();
  let best = null; let bestScore = 0;
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of kws) { if (t.includes(kw)) score++; }
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}

// ─────────────────────────── 시스템 프롬프트 ───────────────────────────

const KOICD_SYSTEM_PROMPT = `당신은 보험 분쟁 법원 판례 재가공 전문가다. 주어진 판결문을 분석하여 사정서에서 인용 가능한 형태로 가공한다. 사정서는 피보험자(고객) 측 입장에서 작성되므로 가이드도 그 관점에서 작성한다.

--- 출력 전 반드시 먼저 판단 ---
1. 결정 방향성: 원고(피보험자) 측이 승소했는가, 패소했는가?
   - 원고 승소·청구 인용 → "원고 승소"
   - 원고 패소·청구 기각 → "원고 패소"
   - 일부 인용 → "일부 인용"
   - 파기환송(피보험자에게 유리한 방향) → "파기환송 - 원고 유리"
   - 파기환송(보험회사에게 유리한 방향) → "파기환송 - 피고 유리"
2. 사정서 인용 가능성: 아래 4가지 중 하나 선택:
   - "핵심 인용 자료": 원고 승소, 피보험자에게 유리한 약관해석·법리
   - "보조 인용 자료": 일부 인용 또는 일반 법리 정립 사례
   - "구별 논거용": 원고 패소, 보험회사 측에 유리한 판결 (본 사안이 해당 판례와 다름을 차단 논거로 활용)
   - "역공 차단용": 보험회사가 이 판례를 자기 측에 유리하게 인용할 가능성이 높은 경우 (사정서에 사전 차단 논거를 박아둠)
⚠️ 원고 패소 사례를 "피보험자 유리 법리"로 가공하면 사정서 오류다. 반드시 방향성을 정확히 판단하라.
---

출력 형식은 다음을 반드시 이 순서로 포함:
1. 첫 줄: "판례번호: [법원명] YYYY.MM.DD. 선고 YYYY[다/나/가합/구합 등]NNNNN [사건명] 판결"
2. (대법원 판례의 경우만) "원심: ..." — 하급심 판례는 이 줄 생략
3. "결정 방향성: [위 판단 결과]" — 항상 포함
4. "사정서 인용 가능성: [핵심 인용 자료|보조 인용 자료|구별 논거용|역공 차단용]" — 항상 포함
5. 【사안의 사실관계】 헤더 포함, 보험계약 정보 + 청구 사실 + 검사·진료 경과 + 부지급 사유 (200~400자)
6. 【쟁점】 헤더 포함, 다투어진 핵심 쟁점 1~3개 (100~200자)
7. 【대법원 판단의 핵심】 또는 【고등법원 판단의 핵심】 또는 【지방법원 판단의 핵심】 헤더 포함, 결정 요지 (300~500자)
8. 【사정서 활용 가이드 - [분류에 따른 부제목]】 헤더 포함, 부제목은 사정서 인용 가능성 분류에 따라 자동 결정:
   - "핵심 인용 자료" → "- 피보험자 유리 법리 적극 인용"
   - "보조 인용 자료" → "- 보조 법리 인용"
   - "구별 논거용" → "- 구별 논거 (보험회사 측 인용 차단)"
   - "역공 차단용" → "- 보험회사 역공 차단 (사전 방어)"
   내용 (300~500자): 구별 논거용은 "보험회사가 본 판례를 인용할 경우 다음 사유로 본 사안에 적용 불가하다고 차단할 수 있다..." 형식으로 작성. 역공 차단용은 "사정서에 다음 차단 문구를 사전에 박아둠으로써 보험회사 인용을 무력화할 수 있다..." 형식으로 작성.
9. 【사정서 인용 시 핵심 문구】 헤더 포함, 그대로 사정서에 박을 수 있는 인용 문장 1~2개
10. 【키워드】 헤더 포함, [법원명] [사건번호] + 진단명 + ICD 코드 + 핵심 법리 + 분쟁 유형

각 섹션 헤더는 위 형식 그대로 사용 (대괄호 【】 포함).
총 길이: 1,100~3,500자.
객관적 사실만 기술. 추측/의견 금지.
JSON 출력 금지. 일반 텍스트 형식으로만.
법원 판례는 법적 구속력이 있으므로 그 권위를 명시.

--- 출력 예시 (이 형식을 반드시 따를 것) ---
판례번호: 대법원 2014.6.12. 선고 2013다208661 보험금 청구 판결
원심: 전주지방법원 2013.6.21. 선고 2013나990 판결 (파기환송)
결정 방향성: 파기환송 - 피고 유리
사정서 인용 가능성: 역공 차단용

【사안의 사실관계】
- 피고: 동부화재해상보험 주식회사
- 원고는 허혈성심질환 진단비 특약에 가입
- 검사 결과: 심전도·심초음파·심근효소검사 모두 정상, 관상동맥조영술에서 20% 협착
- C병원 의사는 "상세불명의 협심증"으로 진단, 스텐트 시술하지 않음
- 보험회사는 타 병원 의사 자문을 받아 "20% 협착은 의미 없는 협착"이라며 부지급

【쟁점】
보험약관상 허혈성심질환 진단확정 인정 기준 / 의사 진단의 객관적 타당성 / 사후 검증 가능 여부

【대법원 판단의 핵심】
대법원은 보험약관에 따른 진단확정이 인정되기 위해서는 다음 요건이 필요하다고 판시:
(1) 의사 자격증 소지자가
(2) 병력과 함께 심전도·심장초음파·관상동맥촬영술·혈액 중 심장효소 등의 객관적 검사 결과를 근거로
(3) 일반적인 의료기준에 따라
(4) 한국표준질병사인분류상의 허혈성심질환으로 진단 확정한 경우라야 함

즉 의사가 일정한 검사를 거쳐 진단한 경우, 진단의 기초가 된 검사 결과가 충분하지 아니하거나 일반적인 의료기준에 미흡하다고 볼 수 있는 객관적 사정들이 나타나 있다면, 그 진단 사실만으로 보험사고가 발생하였다고 단정할 수 없다.

【사정서 활용 가이드 - 보험회사 역공 차단 (사전 방어)】
보험회사가 본 판례를 들어 "의사 진단만으로 진단확정이 부족하다"고 주장할 수 있으나, 그 적용에는 다음 제한이 따른다:

(가) 본 판례는 객관적 검사 결과가 일반적 의료기준에 미흡한 사안에 한해 사후 검증을 인정한 것이다. 본 판례 사안은 20% 협착, 심전도·심초음파·심근효소검사 모두 정상이라는 진단 자체의 기초가 부실한 사안이었다.

(나) 검사 결과가 객관적으로 충분하고 일반적 의료기준에 부합하는 사안에는 본 판례의 사후 검증 법리가 적용되지 않으며, 오히려 본 판례가 확인한 약관 해석 원칙이 피보험자에게 유리하게 적용된다.

【사정서 인용 시 핵심 문구】
"보험회사가 대법원 2014.6.12. 선고 2013다208661 판결을 들어 의사 진단만으로 진단확정이 부족하다고 주장할 수 있으나, 위 판결은 20% 협착에 불과하고 객관적 검사가 모두 정상이었던 사안에서 진단의 객관적 기초가 부실한 경우에 한해 사후 검증을 인정한 것이다."

【키워드】
대법원 2013다208661, 허혈성심질환, 급성심근경색, NSTEMI, I21.4, 진단확정, 약관해석, 작성자 불이익 원칙, 증명책임, 관상동맥조영술, 심근효소, 의료기준

--- 법리·약관해석 원칙 사건 처리 지침 ---
사건이 특정 질환에 한정되지 않고 보험약관 해석 원칙, 증명책임 분배, 작성자 불이익 원칙 등 일반 법리를 다루는 경우:
- 【사정서 활용 가이드】에 반드시 "본 판례는 질환 종류에 무관하게 [약관해석/증명책임/고지의무 등] 전반에 걸쳐 활용 가능하다"고 명시할 것
- 【키워드】에 "약관해석 원칙", "작성자 불이익 원칙", "증명책임", "고지의무" 등 해당 법리 키워드를 반드시 포함
- 【사정서 인용 시 핵심 문구】에 해당 법리를 직접 인용할 수 있는 문장을 반드시 포함할 것

⚠️ 길이 엄수: 총 출력은 반드시 1,100자 이상 3,500자 이하. 각 섹션을 지정 범위의 중간값 이상으로 작성하고, 모든 섹션을 빠짐없이 포함할 것.`;

const FSS_SYSTEM_PROMPT = `당신은 금융감독원 분쟁조정결정례 재가공 전문가다. 주어진 결정문을 분석하여 보험 사정서에서 인용 가능한 형태로 가공한다. 사정서는 피보험자(신청인) 측 입장에서 작성되므로 가이드도 그 관점에서 작성한다.

--- 출력 전 반드시 먼저 판단 ---
1. 결정 방향성: 금융감독원 분쟁조정위원회가 신청인(피보험자) 측을 지지했는가?
   - 신청인 청구 인용 → "신청인 청구 인용"
   - 신청인 청구 기각 → "신청인 청구 기각"
   - 일부 인용 → "일부 인용"
   - 조정 결렬 → "조정 결렬"
2. 사정서 인용 가능성: 아래 4가지 중 하나 선택:
   - "핵심 인용 자료": 신청인 청구 인용, 피보험자에게 유리한 약관해석·법리
   - "보조 인용 자료": 일부 인용 또는 일반 원칙 정립 결정례
   - "구별 논거용": 신청인 청구 기각, 보험회사 측에 유리한 결정례 (본 사안이 해당 결정례와 다름을 차단 논거로 활용)
   - "역공 차단용": 보험회사가 이 결정례를 자기 측에 유리하게 인용할 가능성이 높은 경우 (사정서에 사전 차단 논거를 박아둠)
⚠️ 신청인 청구 기각 사례를 "피보험자 유리 법리"로 가공하면 사정서 오류다. 반드시 결과를 정확히 판단하라.
---

출력 형식은 다음을 반드시 이 순서로 포함:
1. 첫 줄: "결정번호: 금융감독원 분쟁조정위원회 의결안건 제YYYY-NN호"
2. 두 번째 줄: "결정일자: YYYY.MM.DD"
3. 세 번째 줄: "분쟁 유형: [보험기타/손해보험/자동차보험/금융투자기타] - [구체 쟁점]"
4. "결정 방향성: [위 판단 결과]" — 항상 포함
5. "사정서 인용 가능성: [핵심 인용 자료|보조 인용 자료|구별 논거용|역공 차단용]" — 항상 포함
6. 【사안의 사실관계】 헤더 포함, 신청인 + 피신청인 + 보험계약 + 사고 경위 + 부지급 사유 (200~400자)
7. 【쟁점】 헤더 포함, 다투어진 핵심 쟁점 1~3개 (100~200자)
8. 【분쟁조정위원회 판단의 핵심】 헤더 포함, 결정 요지 + 결과 (지급/부지급/기각) (300~500자)
9. 【사정서 활용 가이드 - [분류에 따른 부제목]】 헤더 포함, 부제목은 사정서 인용 가능성 분류에 따라 자동 결정:
   - "핵심 인용 자료" → "- 피보험자 유리 법리 적극 인용"
   - "보조 인용 자료" → "- 보조 법리 인용"
   - "구별 논거용" → "- 구별 논거 (보험회사 측 인용 차단)"
   - "역공 차단용" → "- 보험회사 역공 차단 (사전 방어)"
   내용 (300~500자): 구별 논거용은 "보험회사가 본 결정례를 인용할 경우 다음 사유로 본 사안에 적용 불가하다고 차단할 수 있다..." 형식으로 작성. 역공 차단용은 "사정서에 다음 차단 문구를 사전에 박아둠으로써 보험회사 인용을 무력화할 수 있다..." 형식으로 작성.
10. 【사정서 인용 시 핵심 문구】 헤더 포함, 그대로 사정서에 박을 수 있는 인용 문장 1~2개. "금융감독원 분쟁조정위원회는 YYYY.MM.DD. 의결안건 제YYYY-NN호에서 ..." 형식
11. 【키워드】 헤더 포함, "금감원 분쟁조정", "의결안건 YYYY-NN호", 진단명/사건 유형, 핵심 법리

각 섹션 헤더는 위 형식 그대로 사용 (대괄호 【】 포함).
총 길이: 1,100~3,500자.
객관적 사실만 기술. 추측/의견 금지.
JSON 출력 금지. 일반 텍스트 형식으로만.
금감원 분쟁조정은 권고 효력이지만 동일 유형 분쟁에서 선례 가치가 있음을 강조.

--- 출력 예시 (이 형식을 반드시 따를 것) ---
결정번호: 금융감독원 분쟁조정위원회 의결안건 제2023-2호
결정일자: 2023.11.24
분쟁 유형: 보험기타 - 일본뇌염의 상해사고 인정여부
결정 방향성: 신청인 청구 기각
사정서 인용 가능성: 구별 논거용

【사안의 사실관계】
- 신청인: 보험계약자 (피보험자)
- 피신청인: ○○생명보험 주식회사
- 보험계약: 상해보험 (일반사망/상해의료비)
- 사고 경위: 신청인은 야외 활동 중 모기에 물려 일본뇌염 감염 진단을 받음
- 부지급 사유: 보험회사는 "일본뇌염은 질병이지 상해사고가 아니다"라며 부지급 결정

【쟁점】
모기에 의한 일본뇌염 감염이 약관상 "급격하고 우연한 외래의 사고"에 해당하는지 여부. 바이러스 감염의 잠복기로 인한 급격성 요건 충족 여부.

【분쟁조정위원회 판단의 핵심】
분쟁조정위원회는 다음 사유로 신청인 청구를 기각함:
(1) 일본뇌염 바이러스 감염은 모기 교상 후 잠복기를 거쳐 발병하므로 "급격성" 요건을 충족하지 못함
(2) 바이러스 매개 감염에 의한 뇌염은 질병 담보 사항으로, 상해 담보 범위에 해당하지 않음
(3) 모기 교상 자체는 외래의 사고이나, 이로 인한 바이러스 감염은 별개의 질병 진행 과정임

결과: 신청인 청구 기각. 보험회사 부지급 결정 유지.

【사정서 활용 가이드 - 구별 논거 (보험회사 측 인용 차단)】
보험회사가 본 결정례를 들어 "금감원도 감염성 질환을 상해로 인정하지 않는다"고 주장할 수 있으나, 다음 사유로 본 사안에 적용이 제한된다:

(가) 본 결정례는 모기 매개 바이러스 감염(일본뇌염)의 급격성 충족 여부에 관한 것으로, 본 사안의 사고 경위 및 손해 발생 원인이 다를 경우 적용 불가
(나) 보험약관상 담보 범위와 "상해" 정의가 다를 경우 본 결정례의 판단 기준이 그대로 적용되지 않음
(다) 본 사안의 손해 발생 경위, 약관 문언, 담보 범위가 본 결정례와 어떻게 다른지를 구체적으로 명시하여 선례 차단 논거로 활용할 것

【사정서 인용 시 핵심 문구】
"금융감독원 분쟁조정위원회 2023-2호 결정은 일본뇌염 바이러스 감염의 급격성 부재를 이유로 기각한 것으로, 본 사안은 사고 경위와 손해 발생 원인이 달라 위 결정례가 직접 적용되지 않는다."

【키워드】
금감원 분쟁조정, 의결안건 2023-2호, 일본뇌염, 상해사고, 급격성, 외래성, 바이러스감염, 구별논거, 보험기타, 약관해석

--- 법리·약관해석 원칙 결정례 처리 지침 ---
결정례가 특정 질환에 한정되지 않고 약관 해석 원칙, 고지의무 위반 처리 기준 등 일반 원칙을 다루는 경우:
- 【사정서 활용 가이드】에 반드시 "본 결정례는 질환 종류에 무관하게 [약관해석/증명책임 등] 전반에 걸쳐 활용 가능하다"고 명시할 것
- 【키워드】에 "약관해석 원칙", "작성자 불이익 원칙", "분쟁조정", "고지의무" 등 해당 법리 키워드를 반드시 포함
- 【사정서 인용 시 핵심 문구】에 금감원 결정 기반 인용 문구를 반드시 포함할 것

⚠️ 길이 엄수: 총 출력은 반드시 1,100자 이상 3,500자 이하. 각 섹션을 지정 범위의 중간값 이상으로 작성하고, 모든 섹션을 빠짐없이 포함할 것.`;

// ─────────────────────────── 형식 검증 ───────────────────────────

function validateKoicdFormat(text) {
  const errs = [];
  if (!text || text.trimStart().startsWith('{')) errs.push('JSON 출력 금지');
  if (!text || !/^판례번호:/m.test(text)) errs.push('"판례번호:" 없음');
  if (!text || !text.includes('【사안의 사실관계】')) errs.push('【사안의 사실관계】 없음');
  if (!text || !text.includes('【쟁점】')) errs.push('【쟁점】 없음');
  if (!text || !(/【.{1,10}법원 판단의 핵심】/.test(text))) errs.push('【XX법원 판단의 핵심】 없음');
  if (!text || !(/【사정서 활용 가이드.*】/.test(text))) errs.push('【사정서 활용 가이드】 없음');
  if (!text || !text.includes('【사정서 인용 시 핵심 문구】')) errs.push('【사정서 인용 시 핵심 문구】 없음');
  if (!text || !text.includes('【키워드】')) errs.push('【키워드】 없음');
  if (!text || text.length < 1100) errs.push(`총 길이 부족 (${text?.length || 0}자 < 1100자)`);
  if (!text || text.length > 3500) errs.push(`총 길이 초과 (${text?.length || 0}자 > 3500자)`);
  if (!text || !/결정 방향성:/m.test(text)) errs.push('"결정 방향성:" 없음');
  if (!text || !/사정서 인용 가능성:/m.test(text)) errs.push('"사정서 인용 가능성:" 없음');
  if (text && !/핵심 인용 자료|보조 인용 자료|구별 논거용|역공 차단용/.test(text)) errs.push('"사정서 인용 가능성" 유효하지 않은 값');
  return errs;
}

function validateFssFormat(text) {
  const errs = [];
  if (!text || text.trimStart().startsWith('{')) errs.push('JSON 출력 금지');
  const lines = (text || '').split('\n');
  if (!lines[0]?.startsWith('결정번호:')) errs.push('첫 줄 "결정번호:" 없음');
  if (!lines[1]?.startsWith('결정일자:')) errs.push('두 번째 줄 "결정일자:" 없음');
  if (!lines[2]?.startsWith('분쟁 유형:')) errs.push('세 번째 줄 "분쟁 유형:" 없음');
  if (!text || !text.includes('【사안의 사실관계】')) errs.push('【사안의 사실관계】 없음');
  if (!text || !text.includes('【쟁점】')) errs.push('【쟁점】 없음');
  if (!text || !text.includes('【분쟁조정위원회 판단의 핵심】')) errs.push('【분쟁조정위원회 판단의 핵심】 없음');
  if (!text || !(/【사정서 활용 가이드.*】/.test(text))) errs.push('【사정서 활용 가이드】 없음');
  if (!text || !text.includes('【사정서 인용 시 핵심 문구】')) errs.push('【사정서 인용 시 핵심 문구】 없음');
  if (!text || !text.includes('【키워드】')) errs.push('【키워드】 없음');
  if (!text || text.length < 1100) errs.push(`총 길이 부족 (${text?.length || 0}자 < 1100자)`);
  if (!text || text.length > 3500) errs.push(`총 길이 초과 (${text?.length || 0}자 > 3500자)`);
  if (!text || !/결정 방향성:/m.test(text)) errs.push('"결정 방향성:" 없음');
  if (!text || !/사정서 인용 가능성:/m.test(text)) errs.push('"사정서 인용 가능성:" 없음');
  if (text && !/핵심 인용 자료|보조 인용 자료|구별 논거용|역공 차단용/.test(text)) errs.push('"사정서 인용 가능성" 유효하지 않은 값');
  return errs;
}

// ─────────────────────────── 유틸리티 ───────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function truncateSourceText(text, maxChars = MAX_INPUT_CHARS) {
  if (!text || text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  const front = text.slice(0, half);
  const rest = text.slice(half);
  const keywords = ['주문', '이유', '결정이유', '분쟁조정결정사항', '조정결정', '판결이유', '판단'];
  let bestPos = -1;
  for (const kw of keywords) {
    const pos = rest.lastIndexOf(kw);
    if (pos > bestPos) bestPos = pos;
  }
  if (bestPos > 0) {
    const tailStart = Math.max(0, bestPos - 200);
    const tail = rest.slice(tailStart, tailStart + half);
    return `${front}\n\n[... 중략 (원문 ${text.length}자) ...]\n\n${tail}`;
  }
  return `${front}\n\n[... 중략 (원문 ${text.length}자) ...]\n\n${text.slice(-half)}`;
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch {}
}

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8')); } catch { return {}; }
}
function saveProgress(p) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(p, null, 2));
}

function appendFormatFailure(record, lastResponse, errors, attempt) {
  const entry = [
    `\n---`,
    `## ${new Date().toISOString()} | ${record.source} | ${record.id}`,
    `**제목:** ${record.title}`,
    `**시도횟수:** ${attempt}`,
    `**검증 오류:** ${errors.join(', ')}`,
    `**응답 미리보기 (500자):**`,
    '```',
    (lastResponse || '').slice(0, 500),
    '```',
  ].join('\n');
  fs.appendFileSync(FORMAT_FAILURES_PATH, entry + '\n');
}

// ─────────────────────────── OpenAI 호출 ───────────────────────────

async function callGPT4o(systemPrompt, userPrompt, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OAI_KEY}` },
      body: JSON.stringify({
        model: GPT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.15,
        max_tokens: 4000,
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      if (resp.status === 429 && attempt < retries) { await sleep(6000 * attempt); continue; }
      throw new Error(`GPT-4o ${resp.status}: ${err.slice(0, 200)}`);
    }
    const json = await resp.json();
    const text = json.choices?.[0]?.message?.content || '';
    const usage = json.usage || {};
    return { text, usage };
  }
  throw new Error('GPT-4o 최대 재시도 초과');
}

async function callWithFormatRetry(record, systemPrompt, userPrompt, validateFn) {
  let lastText = '';
  let lastErrors = [];

  for (let attempt = 1; attempt <= MAX_FORMAT_RETRIES + 1; attempt++) {
    let prompt = userPrompt;

    if (attempt === 2 && lastErrors.length > 0) {
      prompt = userPrompt + `\n\n⚠️ 형식 재확인 필요. 누락된 항목: ${lastErrors.join(', ')}\n반드시 위 시스템 프롬프트의 형식 그대로 출력하세요.`;
    } else if (attempt === 3 && lastErrors.length > 0) {
      // 3차: few-shot 예시 포함한 강력 재요청
      prompt = userPrompt + `\n\n🚨 최종 경고. 반드시 시스템 프롬프트의 예시와 동일한 형식으로 출력하세요.\n누락 항목: ${lastErrors.join(', ')}\n예시 형식을 그대로 복사하여 내용만 바꾸세요.`;
    }

    const { text, usage } = await callGPT4o(systemPrompt, prompt);
    lastText = text;

    const errors = validateFn(text);
    lastErrors = errors;

    if (errors.length === 0) {
      return { text, usage, attempt, formatOk: true };
    }

    log(`  형식 검증 실패 (시도 ${attempt}/${MAX_FORMAT_RETRIES + 1}): ${errors.join(', ')}`);
    if (attempt < MAX_FORMAT_RETRIES + 1) await sleep(1000);
  }

  // 3회 모두 실패
  appendFormatFailure(record, lastText, lastErrors, MAX_FORMAT_RETRIES + 1);
  return { text: lastText, usage: {}, attempt: MAX_FORMAT_RETRIES + 1, formatOk: false };
}

async function createEmbedding(input) {
  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OAI_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input }),
  });
  if (!resp.ok) throw new Error(`Embedding ${resp.status}: ${await resp.text().then(t => t.slice(0, 100))}`);
  const json = await resp.json();
  return json.data?.[0]?.embedding;
}

// ─────────────────────────── 프롬프트 빌더 ───────────────────────────

const LENGTH_REMINDER_FSS = `
⚠️ 출력 길이 요건: 총 1,100자 이상. 각 섹션(특히 【분쟁조정위원회 판단의 핵심】 【사정서 활용 가이드】)을 충분히 상세하게 작성하라.`;

function buildFssUserPrompt(record) {
  const txtFile = path.join(FSS_TXT_DIR, record.file || '');
  let fullText = '';
  try {
    fullText = fs.readFileSync(txtFile, 'utf8');
  } catch (e) {
    log(`  FSS txt 읽기 실패 (${txtFile}): ${e.message}`);
    fullText = `[파일 읽기 실패: ${record.file}]`;
  }
  const truncated = truncateSourceText(fullText);
  const parts = [
    `제목: ${record.title || ''}`,
    `파일명: ${record.file || ''}`,
    `결정일자: ${record.date || ''}`,
    `본문:\n${truncated}`,
  ];
  return `다음 금융감독원 분쟁조정결정례를 위 형식으로 재가공해주세요:\n\n${parts.join('\n\n')}${LENGTH_REMINDER_FSS}`;
}

const LENGTH_REMINDER_KOICD = `
⚠️ 출력 길이 요건: 총 1,100자 이상. 각 섹션(특히 【XX법원 판단의 핵심】 【사정서 활용 가이드】)을 충분히 상세하게 작성하라.`;

async function buildKoicdUserPrompt(sb, record) {
  let dbRow = null;
  try {
    const { data } = await sb.from('court_precedents')
      .select('full_text_excerpt,court_or_agency,insurance_type,accident_type,issue,conclusion,key_points,summary')
      .eq('id', record.id)
      .single();
    dbRow = data;
  } catch (e) {
    log(`  KOICD DB 조회 실패 (id=${record.id}): ${e.message}`);
  }
  const fullText = dbRow?.full_text_excerpt || '';
  const truncated = truncateSourceText(fullText);
  const parts = [
    `사건명: ${record.title || ''}`,
    `사건번호: ${record.case_number || ''}`,
    `선고일자: ${record.date || ''}`,
  ];
  if (dbRow?.court_or_agency) parts.push(`법원: ${dbRow.court_or_agency}`);
  if (dbRow?.insurance_type) parts.push(`보험종류: ${dbRow.insurance_type}`);
  if (dbRow?.accident_type) parts.push(`사고유형: ${dbRow.accident_type}`);
  if (dbRow?.issue) parts.push(`쟁점: ${dbRow.issue}`);
  if (dbRow?.conclusion) parts.push(`결론: ${dbRow.conclusion}`);
  if (dbRow?.key_points) parts.push(`핵심포인트: ${dbRow.key_points}`);
  if (dbRow?.summary) parts.push(`요약: ${dbRow.summary}`);
  if (truncated) parts.push(`본문발췌:\n${truncated}`);
  return `다음 법원 판례를 위 형식으로 재가공해주세요:\n\n${parts.join('\n\n')}${LENGTH_REMINDER_KOICD}`;
}

// ─────────────────────────── 후보 선별 ───────────────────────────

async function selectFssCandidates(sb, targetCount) {
  log(`FSS 후보 선별 시작 (목표 ${targetCount}건)`);
  const { data, error } = await sb.from('fss_dispute_cases')
    .select('id,record_id,title,case_number,court_or_agency,decision_date,insurance_type,accident_type,issue,conclusion,key_points,summary,full_text_excerpt,source_status')
    .order('decision_date', { ascending: false })
    .limit(400);
  if (error) throw new Error('FSS select: ' + error.message);

  const rows = (data || []).map(r => ({ ...r, _source: 'fss' }));
  return selectByCategoryBalance(rows, targetCount, 'FSS');
}

async function selectKoicdCandidates(sb, targetCount) {
  log(`KOICD 후보 선별 시작 (목표 ${targetCount}건)`);
  const { data, error } = await sb.from('court_precedents')
    .select('id,record_id,title,case_number,court_or_agency,decision_date,insurance_type,accident_type,issue,conclusion,key_points,summary,full_text_excerpt,source_status')
    .order('decision_date', { ascending: false })
    .limit(900);
  if (error) throw new Error('KOICD select: ' + error.message);

  const rows = (data || []).map(r => ({ ...r, _source: 'koicd' }));
  return selectByCategoryBalance(rows, targetCount, 'KOICD');
}

function selectByCategoryBalance(rows, targetCount, label) {
  const byCat = { heart: [], brain: [], cancer: [], disability: [], silson: [] };
  const other = [];
  for (const row of rows) {
    const text = `${row.title||''} ${row.accident_type||''} ${row.summary||''} ${row.key_points||''}`;
    const cat = matchCategory(text);
    if (cat && byCat[cat]) byCat[cat].push({ ...row, _category: cat });
    else other.push({ ...row, _category: 'other' });
  }

  const perCat = Math.ceil(targetCount / 5);
  const selected = [];
  for (const [cat, items] of Object.entries(byCat)) {
    const sorted = items.sort((a, b) => {
      const ra = a.decision_date >= '2016-01-01' ? 1 : 0;
      const rb = b.decision_date >= '2016-01-01' ? 1 : 0;
      return rb - ra || (b.decision_date || '').localeCompare(a.decision_date || '');
    });
    const picked = sorted.slice(0, perCat);
    selected.push(...picked);
    log(`  ${label} ${cat}: ${items.length}건 → ${picked.length}건`);
  }

  // 부족한 경우 other에서 보충 (보험 관련 키워드 우선)
  if (selected.length < targetCount) {
    const need = targetCount - selected.length;
    const insuranceKws = ['보험','보험금','피보험자','보험계약','약관'];
    const filtered = other
      .filter(r => insuranceKws.some(kw => (r.title || '').includes(kw) || (r.summary || '').includes(kw)))
      .sort((a, b) => (b.decision_date || '').localeCompare(a.decision_date || ''))
      .slice(0, need);
    selected.push(...filtered);
    log(`  ${label} other 보충: ${filtered.length}건`);
  }

  const final = selected.slice(0, targetCount);
  log(`${label} 후보 총 ${final.length}건 선별 완료`);
  return final;
}

// ─────────────────────────── 메타데이터 추출 ───────────────────────────

function extractDecisionDirection(text) {
  const m = (text || '').match(/^결정 방향성:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

function extractUsageClassification(text) {
  const m = (text || '').match(/^사정서 인용 가능성:\s*(.+)$/m);
  if (!m) return null;
  const val = m[1].trim();
  if (val.includes('핵심')) return '핵심 인용';
  if (val.includes('보조')) return '보조 인용';
  if (val.includes('구별')) return '구별 논거';
  if (val.includes('역공')) return '역공 차단';
  return val;
}

function extractPeaceOfMind(classification) {
  if (!classification) return 'neutral';
  if (classification === '핵심 인용' || classification === '보조 인용') return 'favorable';
  if (classification === '구별 논거' || classification === '역공 차단') return 'unfavorable';
  return 'neutral';
}

// ─────────────────────────── DB 백업 ───────────────────────────

async function backupExistingChunks(sb, candidates) {
  log('기존 rag_master_chunks 백업 시작...');
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const backupData = [];
  for (const record of candidates) {
    try {
      let rows = [];
      if (record.source === 'fss') {
        const nttId = record.ntt_id || String(record.id);
        const { data: d1 } = await sb.from('rag_master_chunks')
          .select('id,chunk_id,chunk_text,metadata,embedding_status,source_type')
          .eq('metadata->>ntt_id', nttId);
        const { data: d2 } = await sb.from('rag_master_chunks')
          .select('id,chunk_id,chunk_text,metadata,embedding_status,source_type')
          .ilike('chunk_id', `%ntt${nttId}%`);
        const seen = new Set();
        rows = [...(d1 || []), ...(d2 || [])].filter(r => seen.has(r.id) ? false : seen.add(r.id));
      } else {
        if (!record.case_number) continue;
        const { data } = await sb.from('rag_master_chunks')
          .select('id,chunk_id,chunk_text,metadata,embedding_status,source_type')
          .eq('metadata->>case_number', record.case_number)
          .in('source_type', ['court_precedent', 'court_precedent_fulltext']);
        rows = data || [];
      }
      backupData.push({ id: record.id, ntt_id: record.ntt_id, case_number: record.case_number, existingChunks: rows });
    } catch { /* 개별 실패 무시 */ }
  }

  const backupPath = path.join(BACKUP_DIR, `backup_${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
  log(`백업 완료: ${backupPath} (${backupData.length}건)`);
  return backupPath;
}

// ─────────────────────────── DB 업서트 ───────────────────────────

async function upsertChunk(sb, record, chunkText, dryRun) {
  const isKoicd = record.source === 'koicd';
  const category = record.primary || 'other';
  const sourceType = isKoicd ? 'court_precedent' : 'fss_dispute_resolution_case';
  const sourceArea = isKoicd ? 'court_precedents' : 'fss_dispute_cases';
  const nttId = !isKoicd ? (record.ntt_id || String(record.id)) : null;
  const chunkId = isKoicd
    ? `phase2b_koicd_${record.id}`
    : `phase2b_fss_ntt${nttId}`;

  const keywords = extractKeywords(chunkText);
  const usageClassification = extractUsageClassification(chunkText);

  const appliesAll = record.primary === 'legal_principle';
  let usagePriority = 'reference';
  if (['legal_principle', 'life'].includes(record.primary)) usagePriority = 'critical';
  else if (['cancer', 'disability', 'silson'].includes(record.primary)) usagePriority = 'important';

  const scoreVals = Object.values(record.scores || {});
  const maxScore = scoreVals.length > 0 ? Math.max(...scoreVals) : 0;
  let disputeFrequency = 'low';
  if (maxScore >= 3) disputeFrequency = 'high';
  else if (maxScore >= 2) disputeFrequency = 'medium';

  const meta = {
    case_number: record.case_number || null,
    decision_date: record.date || null,
    category,
    tags: record.tags || [category],
    applies_to_all_categories: appliesAll,
    dispute_frequency_rating: disputeFrequency,
    usage_priority: usagePriority,
    original_source: record.source,
    source_type: sourceType,
    reprocessed_at: new Date().toISOString(),
    reprocessing_source: 'phase2b',
    source_status: 'reprocessed_v1',
    official_citation_allowed: true,
    release_stage: 'active',
    format_version: isKoicd ? 'v2013da208661_pattern' : 'v_fss_disputeresolution_pattern',
    ntt_id: nttId,
    original_source_file: !isKoicd ? (record.file || null) : null,
    decision_direction: extractDecisionDirection(chunkText),
    usage_classification: usageClassification,
    peace_of_mind: extractPeaceOfMind(usageClassification),
  };

  // 매칭: 기존 row 찾기
  let existingId = null;
  if (!isKoicd && nttId) {
    const { data: d1 } = await sb.from('rag_master_chunks')
      .select('id,chunk_id')
      .eq('metadata->>ntt_id', nttId)
      .limit(1);
    existingId = d1?.[0]?.id || null;
    if (!existingId) {
      const { data: d2 } = await sb.from('rag_master_chunks')
        .select('id,chunk_id')
        .ilike('chunk_id', `%ntt${nttId}%`)
        .limit(1);
      existingId = d2?.[0]?.id || null;
    }
  } else if (isKoicd && record.case_number) {
    const { data } = await sb.from('rag_master_chunks')
      .select('id,chunk_id')
      .eq('metadata->>case_number', record.case_number)
      .in('source_type', ['court_precedent', 'court_precedent_fulltext'])
      .limit(1);
    existingId = data?.[0]?.id || null;
  }

  if (dryRun) {
    return { op: existingId ? 'update' : 'insert', id: existingId || '(dry-run)', dryRun: true };
  }

  if (existingId) {
    const { error } = await sb.from('rag_master_chunks').update({
      chunk_text: chunkText,
      title: record.title || '',
      keywords,
      metadata: meta,
      review_status: 'reviewed',
      embedding: null,
      embedding_status: 'pending',
      embedding_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', existingId);
    if (error) throw new Error(`UPDATE failed: ${error.message}`);
    return { op: 'update', id: existingId };
  } else {
    const { data: inserted, error } = await sb.from('rag_master_chunks').insert({
      chunk_id: chunkId,
      source_area: sourceArea,
      source_type: sourceType,
      source_document_id: sourceType.toUpperCase() + '_PHASE2B',
      source_record_id: String(record.id),
      title: record.title || '',
      chunk_text: chunkText,
      keywords,
      metadata: meta,
      trust_level: 'verified',
      review_status: 'reviewed',
      embedding_status: 'pending',
    }).select('id').single();
    if (error) throw new Error(`INSERT failed: ${error.message}`);
    return { op: 'insert', id: inserted?.id };
  }
}

function extractKeywords(text) {
  const kwMatch = text.match(/【키워드】\s*\n?([\s\S]+?)(?=\n\n|$)/);
  if (!kwMatch) return [];
  return kwMatch[1].split(/[,，\n]/).map(k => k.trim()).filter(k => k.length > 1 && k.length < 40).slice(0, 15);
}

// ─────────────────────────── 임베딩 ───────────────────────────

async function runEmbedding(sb, ids) {
  log(`임베딩 시작: ${ids.length}건`);
  let ok = 0; let fail = 0;
  let estimatedCost = 0;
  for (const id of ids) {
    try {
      const { data } = await sb.from('rag_master_chunks')
        .select('chunk_text,title,summary,keywords').eq('id', id).single();
      if (!data) continue;
      const input = [data.title, data.summary, data.chunk_text, Array.isArray(data.keywords) ? data.keywords.join(' ') : ''].filter(Boolean).join('\n\n');
      const embedding = await createEmbedding(input);
      const now = new Date().toISOString();
      await sb.from('rag_master_chunks').update({
        embedding,
        embedding_status: 'done',
        embedding_model: EMBED_MODEL,
        embedding_created_at: now,
        embedding_error: null,
        last_embedding_attempt_at: now,
      }).eq('id', id);
      ok++;
      estimatedCost += (input.length / 4) * 0.00000002; // text-embedding-3-small 약 $0.02/1M tokens
      if (ok % 25 === 0) log(`  임베딩 진행: ${ok}/${ids.length} | 추정비용: $${estimatedCost.toFixed(4)}`);
      await sleep(200);
    } catch (e) {
      fail++;
      log(`  임베딩 실패 ${id}: ${e.message}`);
      await sb.from('rag_master_chunks').update({
        embedding_status: 'error',
        embedding_error: e.message.slice(0, 500),
        last_embedding_attempt_at: new Date().toISOString(),
      }).eq('id', id);
    }
  }
  log(`임베딩 완료: ${ok} 성공 / ${fail} 실패 | 추정비용: $${estimatedCost.toFixed(4)}`);
  return { ok, fail };
}

// ─────────────────────────── 사후 검증 ───────────────────────────

async function postVerify(sb, ids) {
  log('사후 검증 시작 (5건 무작위)...');
  // FSS 2건 + KOICD 3건 무작위
  const sample = ids.sort(() => Math.random() - 0.5).slice(0, 5);
  const results = [];
  for (const id of sample) {
    const { data } = await sb.from('rag_master_chunks')
      .select('id,chunk_id,chunk_text,metadata,embedding_status,source_type').eq('id', id).single();
    if (!data) continue;
    const srcType = data.source_type;
    const validateFn = srcType.startsWith('fss') ? validateFssFormat : validateKoicdFormat;
    const errs = validateFn(data.chunk_text);
    results.push({
      id, chunk_id: data.chunk_id, source_type: srcType,
      chunk_text_len: data.chunk_text?.length || 0,
      embedding_done: data.embedding_status === 'done',
      format_ok: errs.length === 0,
      format_errors: errs,
      meta_ok: !!(data.metadata?.reprocessing_source === 'phase2b' && data.metadata?.release_stage === 'active'),
    });
  }
  log('사후 검증 결과:');
  results.forEach(r => {
    log(`  ${r.chunk_id} | len=${r.chunk_text_len} | embed=${r.embedding_done} | fmt=${r.format_ok} | meta=${r.meta_ok}`);
    if (r.format_errors.length > 0) log(`    fmt_errors: ${r.format_errors.join(', ')}`);
  });
  return results;
}

// ─────────────────────────── 메인 ───────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const isSampleMode = argv.includes('--sample');
  const isSelectOnly = argv.includes('--select-only');
  const isEmbedOnly = argv.includes('--embed-only');
  const isDryRun = argv.includes('--dry-run');
  const sourceFilter = argv.includes('--source') ? argv[argv.indexOf('--source') + 1] : null;
  const limitIdx = argv.findIndex(a => a === '--limit');
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1] || 999) : (isSampleMode ? 1 : 999);
  const fromIdx = argv.includes('--from') ? Number(argv[argv.indexOf('--from') + 1] || 0) : 0;

  if (!SB_URL || !SB_KEY) throw new Error('Missing Supabase env vars');
  if (!OAI_KEY && !isSelectOnly) throw new Error('Missing OPENAI_API_KEY');

  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });

  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  log(`=== Phase 2-B' 시작 | sample=${isSampleMode} selectOnly=${isSelectOnly} embedOnly=${isEmbedOnly} dryRun=${isDryRun} source=${sourceFilter || 'all'} limit=${limit} from=${fromIdx}`);

  // ── 1. 후보 선별 ──
  let candidates;
  if (fs.existsSync(CANDIDATES_PATH)) {
    candidates = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));
    log(`기존 후보 ${candidates.length}건 로드`);
  } else {
    const fss = (!sourceFilter || sourceFilter === 'fss') ? await selectFssCandidates(sb, 100) : [];
    const koicd = (!sourceFilter || sourceFilter === 'koicd') ? await selectKoicdCandidates(sb, 150) : [];
    candidates = [...fss, ...koicd];
    fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(candidates, null, 2));
    log(`후보 ${candidates.length}건 저장 → ${CANDIDATES_PATH}`);
  }

  if (isSelectOnly) {
    const dist = {};
    candidates.forEach(c => { const k = `${c.source}:${c.primary||'?'}`; dist[k] = (dist[k]||0)+1; });
    console.log('\n후보 분포:');
    Object.entries(dist).sort().forEach(([k,v]) => console.log(`  ${k}: ${v}건`));
    console.log(`합계: ${candidates.length}건`);
    return;
  }

  const progress = loadProgress();
  const done = new Set(progress.done || []);
  const processedIds = progress.processedIds || [];

  if (isEmbedOnly) {
    await runEmbedding(sb, processedIds);
    return;
  }

  // ── 2. 백업 (dryRun 아닐 때) ──
  if (!isDryRun && !isSampleMode) {
    await backupExistingChunks(sb, candidates);
  }

  // ── 3. 샘플 모드 ──
  if (isSampleMode) {
    const fssSample = candidates.find(c => c.source === 'fss');
    const koicdSample = candidates.find(c => c.source === 'koicd');
    const lpSample = candidates.find(c =>
      (c.tags || []).includes('legal_principle') && c !== fssSample && c !== koicdSample
    ) || candidates.find(c => (c.tags || []).includes('legal_principle'));
    const sampleLines = ['# Phase 2-B\' 샘플 출력\n'];

    for (const record of [fssSample, koicdSample, lpSample].filter(Boolean)) {
      const isFss = record.source === 'fss';
      const systemPrompt = isFss ? FSS_SYSTEM_PROMPT : KOICD_SYSTEM_PROMPT;
      const userPrompt = isFss ? buildFssUserPrompt(record) : await buildKoicdUserPrompt(sb, record);
      const validateFn = isFss ? validateFssFormat : validateKoicdFormat;

      log(`샘플 호출: ${record.source} | ${record.id} | ${(record.title||'').slice(0,50)}`);
      const { text, usage, attempt, formatOk } = await callWithFormatRetry(record, systemPrompt, userPrompt, validateFn);

      const costEst = ((usage?.prompt_tokens||0) * 2.5 + (usage?.completion_tokens||0) * 10) / 1_000_000;
      log(`  결과: 길이=${text.length}자 | 형식OK=${formatOk} | 시도=${attempt} | 비용≈$${costEst.toFixed(4)}`);

      const isLp = record === lpSample && (record.tags || []).includes('legal_principle');
      const sampleLabel = isLp
        ? `${record.source.toUpperCase()} 샘플 (legal_principle)`
        : `${record.source.toUpperCase()} 샘플`;
      sampleLines.push(`## ${sampleLabel}`);
      sampleLines.push(`- id: ${record.id}`);
      sampleLines.push(`- primary: ${record.primary}, tags: ${(record.tags||[]).join(', ')}`);
      sampleLines.push(`- 형식 검증: ${formatOk ? '✅ PASS' : '❌ FAIL'}`);
      sampleLines.push(`- 길이: ${text.length}자\n`);
      sampleLines.push('```');
      sampleLines.push(text);
      sampleLines.push('```\n');
    }

    fs.writeFileSync(SAMPLES_PATH, sampleLines.join('\n'));
    log(`샘플 저장 → ${SAMPLES_PATH}`);

    // 샘플 콘솔 출력
    console.log('\n' + '='.repeat(80));
    console.log(fs.readFileSync(SAMPLES_PATH, 'utf8').slice(0, 6000));
    console.log('='.repeat(80));
    console.log('\n✅ 샘플 3건 출력 완료 (FSS + KOICD + legal_principle). audit/phase2b_samples.md 확인 후 --sample 없이 실행하여 전체 진행 승인.');
    return;
  }

  // ── 4. 메인 재가공 루프 ──
  let sourceFiltered = candidates;
  if (sourceFilter) sourceFiltered = candidates.filter(c => c.source === sourceFilter);

  const toProcess = sourceFiltered
    .filter(c => !done.has(String(c.id)))
    .slice(fromIdx, fromIdx + limit);

  log(`재가공 대상: ${toProcess.length}건`);

  let processed = 0;
  let formatFails = 0;
  let totalCost = 0;
  const fssCounts = { processed: 0, formatFail: 0 };
  const koicdCounts = { processed: 0, formatFail: 0 };

  for (const record of toProcess) {
    const rid = String(record.id);
    const isFss = record.source === 'fss';
    const systemPrompt = isFss ? FSS_SYSTEM_PROMPT : KOICD_SYSTEM_PROMPT;
    const userPrompt = isFss ? buildFssUserPrompt(record) : await buildKoicdUserPrompt(sb, record);
    const validateFn = isFss ? validateFssFormat : validateKoicdFormat;
    const counter = isFss ? fssCounts : koicdCounts;

    try {
      log(`[${processed + 1}/${toProcess.length}] ${record.source} | ${rid} | ${(record.title||'').slice(0,45)}`);

      const { text, usage, attempt, formatOk } = await callWithFormatRetry(record, systemPrompt, userPrompt, validateFn);

      const promptTokens = usage?.prompt_tokens || 0;
      const completionTokens = usage?.completion_tokens || 0;
      const cost = (promptTokens * 2.5 + completionTokens * 10) / 1_000_000;
      totalCost += cost;

      if (!formatOk) {
        formatFails++;
        counter.formatFail++;
        log(`  ⚠️ 형식 검증 최종 실패 (저장 스킵)`);
        // 형식 실패 row는 저장 안 함
      } else {
        const { op, id } = await upsertChunk(sb, record, text, isDryRun);
        if (!isDryRun && id && !processedIds.includes(id)) processedIds.push(id);
        log(`  ✅ ${op} | id=${id} | len=${text.length}자 | tries=${attempt} | cost=$${cost.toFixed(4)}`);
        counter.processed++;
      }

      done.add(rid);
      processed++;

      // 10건마다 진행 로그 + 비용/실패율 체크
      if (processed % 10 === 0) {
        const failRate = formatFails / processed;
        const fssTotal = fssCounts.processed + fssCounts.formatFail;
        const koicdTotal = koicdCounts.processed + koicdCounts.formatFail;
        log(`  ── 진행 ${processed}/${toProcess.length} | 비용=$${totalCost.toFixed(3)} | 형식실패율=${(failRate*100).toFixed(1)}% | FSS:${fssCounts.processed}✅/${fssCounts.formatFail}❌ KOICD:${koicdCounts.processed}✅/${koicdCounts.formatFail}❌`);
        saveProgress({ done: Array.from(done), processedIds, processed, totalCost, formatFails });

        if (totalCost > COST_LIMIT) {
          log(`⛔ 비용 한도 $${COST_LIMIT} 초과 ($${totalCost.toFixed(3)}) — 중단`);
          break;
        }
        if (failRate > FORMAT_FAIL_RATE_LIMIT) {
          log(`⛔ 형식 검증 실패율 ${(failRate*100).toFixed(1)}% > ${FORMAT_FAIL_RATE_LIMIT*100}% — 즉시 중단. 사용자 확인 필요.`);
          saveProgress({ done: Array.from(done), processedIds, processed, totalCost, formatFails, STOPPED: 'FORMAT_FAIL_RATE_EXCEEDED' });
          process.exitCode = 1;
          break;
        }
      }

      await sleep(DELAY_BETWEEN_CALLS);

    } catch (e) {
      log(`  ❌ 오류 [${rid}]: ${e.message}`);
      if (totalCost > COST_LIMIT) { log('비용 초과 — 중단'); break; }
    }
  }

  saveProgress({ done: Array.from(done), processedIds, processed, totalCost, formatFails });
  const finalFailRate = processed > 0 ? formatFails / processed : 0;
  log(`=== 재가공 완료: ${processed}건 처리 | 형식실패=${formatFails}건 (${(finalFailRate*100).toFixed(1)}%) | 비용=$${totalCost.toFixed(3)}`);

  // ── 5. 임베딩 ──
  if (!isDryRun && processedIds.length > 0) {
    await runEmbedding(sb, processedIds);

    // 검증 쿼리
    const { count } = await sb.from('rag_master_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('metadata->>reprocessing_source', 'phase2b');
    log(`DB 검증: phase2b reprocessed count = ${count}`);

    // 사후 검증
    if (processedIds.length >= 5) await postVerify(sb, processedIds);
  }

  log(`=== 전체 완료 | FSS:${fssCounts.processed}건 KOICD:${koicdCounts.processed}건`);
}

main().catch(e => { console.error('FATAL:', e.message, e.stack?.slice(0, 300)); process.exit(1); });
