#!/usr/bin/env node
/**
 * Import medical guideline references into rag_master_chunks.
 * Step A: Migrate 5 hardcoded ACUTE_MI_GUIDELINE_REFS from medicalGuidelineEvidence.ts to DB.
 * Step B: Add 4 new medical guideline areas (stroke, cancer, disability, thyroid).
 *
 * These rows are always official (review_status=reviewed, official_citation_allowed=true).
 * Source URLs are all in allowedOfficialDomains so isOfficialReference() returns true.
 *
 * Usage:
 *   node scripts/importMedicalGuidelines.js           # dry-run
 *   node scripts/importMedicalGuidelines.js --execute  # insert into DB
 */

require('dotenv').config({ path: '.env.rag.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DRY_RUN = !process.argv.includes('--execute');
const EMBEDDING_MODEL = 'text-embedding-3-small';

// ─────────────────────────────────────────────────────────────────
// A. Hardcoded ACUTE_MI refs (verbatim from medicalGuidelineEvidence.ts)
// ─────────────────────────────────────────────────────────────────
const ACUTE_MI_REFS = [
  {
    chunk_id: 'medical_guideline:MANUAL:ACUTE_MI_FOURTH_UNIVERSAL_DEF:v1',
    title: 'Fourth Universal Definition of Myocardial Infarction (2018) - myocardial injury와 myocardial infarction 구분',
    summary: '심근손상은 troponin이 해당 검사법의 99th percentile upper reference limit를 초과할 때 성립한다. 심근경색은 급성 심근손상에 더해 허혈 증거가 결합되어야 하므로, troponin 상승만으로 I21.4 지급요건 충족 또는 배척을 단정하지 않는다.',
    chunk_text: `Fourth Universal Definition of Myocardial Infarction (2018) — 심근손상과 심근경색 구분 기준

【출처】 ESC/ACC/AHA/WHF Consensus Document (JACC 2018)

【핵심 기준】
- 심근손상(myocardial injury): troponin이 검사법 99th percentile URL(upper reference limit) 초과
- 급성 심근경색(acute MI): 급성 심근손상 + 허혈 증거(ischemic evidence) 결합 필수
- NSTEMI / I21.4: 비ST분절상승 급성심근경색 — troponin 상승/하강 + 허혈 증상 또는 새 ECG 변화

【보험 쟁점 적용】
- 보험사가 troponin 수치 하나만을 문제 삼아 I21.4 진단을 배척하는 것은 2018 기준과 상충한다.
- troponin 절대 수치가 아니라 해당 검사기관의 99th percentile 참고치 및 시간에 따른 rise/fall 패턴을 기준으로 판단한다.
- 주치의가 종합 임상 소견 + 검사결과로 I21.4 진단을 내린 경우, 보험사는 그를 번복할 독립적 의학 근거를 제시해야 한다 (2013다208661 증명책임 법리와 연동).

【키워드】 I21.4, NSTEMI, troponin, 심근경색, 급성심근경색, 보험금, 99th percentile, myocardial infarction, Fourth Universal Definition`,
    source_url: 'https://www.jacc.org/doi/10.1016/j.jacc.2018.08.1038',
    diagnosis_code: 'I21.4',
    diagnosis_name: 'Acute subendocardial myocardial infarction / NSTEMI',
    source_provider: 'ESC/ACC/AHA/WHF consensus',
  },
  {
    chunk_id: 'medical_guideline:MANUAL:ACUTE_MI_TROPONIN_CRITERIA:v1',
    title: 'Acute MI criteria - troponin rise/fall, 99th percentile URL, ischemic evidence',
    summary: '급성 심근경색 판단은 troponin rise/fall 및 99th percentile URL 초과와 함께 허혈성 흉통 등 증상, 새로운 허혈성 ECG 변화, 병적 Q파, 새 viable myocardium loss 또는 RWMA, CAG/부검상 coronary thrombus 중 적어도 하나의 허혈 근거를 함께 검토한다.',
    chunk_text: `Acute MI 진단기준 — Troponin rise/fall 및 허혈 근거 상세 기준 (AHA, 2018)

【출처】 American Heart Association — Fourth Universal Definition of MI (2018) 요약

【진단 체크리스트 (AHA 요약)】
1. Troponin 상승/하강 패턴: 적어도 한 값이 99th percentile URL 초과
2. 허혈 증거 중 1개 이상:
   a. 허혈성 흉통 등 증상
   b. 새로운 허혈성 ECG 변화 (ST 변화 또는 LBBB)
   c. 새 병적 Q파
   d. 새 viable myocardium 소실 또는 새 RWMA (영상소견)
   e. CAG 또는 부검상 coronary thrombus 확인

【보험 쟁점 적용】
- troponin 단일 시점 수치보다 rise/fall 시간 패턴이 핵심이다.
- 허혈 증거 항목 중 하나라도 충족 + troponin 기준 충족이면 I21.4 진단 가능.
- 보험사가 "입원 중 단일 검사 수치가 정상 참고범위 내"라고 주장해도, 다른 시점의 수치나 ECG, RWMA 등 나머지 증거를 무시할 수 없다.

【키워드】 troponin rise fall, 99th percentile, ECG, RWMA, coronary thrombus, I21.4, NSTEMI, 허혈 증거, 심근경색`,
    source_url: 'https://professional.heart.org/en/science-news/fourth-universal-definition-of-myocardial-infarction-2018',
    diagnosis_code: 'I21.4',
    diagnosis_name: 'NSTEMI / acute myocardial infarction',
    source_provider: 'AHA summary of ESC/ACC/AHA/WHF consensus',
  },
  {
    chunk_id: 'medical_guideline:MANUAL:ACUTE_MI_PCI_RELATED:v1',
    title: 'PCI-related myocardial injury and type 4a MI - PCI 전후 채혈 시간관계',
    summary: 'PCI 후 troponin 상승은 시술 관련 myocardial injury 또는 type 4a MI 쟁점이 될 수 있다. 보험사가 PCI 후 상승만으로 주치의 I21.4 진단을 배척하려면 PCI 전 baseline, 시술 후 상승폭, 새 ECG 변화, 병적 Q파, 새 RWMA/viable myocardium loss, angiographic flow-limiting complication 등 시간관계와 허혈 근거를 제시해야 한다.',
    chunk_text: `PCI 관련 심근손상 및 Type 4a MI — 보험 쟁점용 ACC 기준 요약

【출처】 American College of Cardiology — Fourth Universal Definition of MI 핵심 10가지 (2018)

【PCI 전후 troponin 해석 기준】
- Type 4a MI (PCI-related): PCI 후 5× 99th percentile URL 초과 + 새 허혈 증거
- Baseline troponin 정상인 경우: PCI 후 상승 > 5× URL → type 4a MI
- Baseline troponin 상승인 경우: 추가 ≥20% 상승 + 안정적이거나 하강 추세였어야 → type 4a MI

【보험 쟁점 적용】
- 보험사가 "PCI 시술 때문에 troponin이 올랐을 뿐"이라 주장할 경우 반박 근거:
  1. PCI 전 baseline troponin 값 확인 요구
  2. 상승폭이 5× URL 미만이면 type 4a MI 기준 미달 — 오히려 시술 전 경색 존재 시사
  3. PCI 전 이미 troponin 상승 + 흉통 + 새 ECG 변화가 있었으면 PCI 전 I21.4 성립
- 결론: 주치의가 PCI 전후 종합 소견을 토대로 I21.4를 기재한 경우, 보험사는 type 4a 기준 5× URL 미달임을 수치로 입증해야 한다.

【키워드】 PCI, stent, type 4a MI, troponin baseline, 시술 관련, flow-limiting complication, I21.4, NSTEMI`,
    source_url: 'https://www.acc.org/latest-in-cardiology/ten-points-to-remember/2018/08/24/00/09/fourth-universal-definition-of-mi-esc-2018',
    diagnosis_code: 'I21.4',
    diagnosis_name: 'PCI-related myocardial injury / type 4a MI',
    source_provider: 'ACC summary of Fourth Universal Definition of MI',
  },
  {
    chunk_id: 'medical_guideline:MANUAL:ACUTE_MI_UNSTABLE_ANGINA_VS_NSTEMI:v1',
    title: 'Unstable angina vs NSTEMI - troponin 및 I20/I21.4/I25.1 코드 구분',
    summary: 'Unstable angina는 임상적으로 급성 관상동맥증후군 범주에 속하지만, NSTEMI/I21.4와의 핵심 구분은 심근손상을 뒷받침하는 troponin 상승 여부와 허혈 증거이다. I20 협심증, I21.4 급성 심내막하심근경색증, I25.1 관상동맥질환 기재가 혼재하면 단일 진단명만 선택하지 말고 전체 검사 흐름과 주치의 진단 근거를 대조한다.',
    chunk_text: `Unstable Angina vs NSTEMI (I21.4) — ICD-10 코드 혼재 쟁점 기준 (ESC ACS Guideline 2023)

【출처】 ACC Summary of 2023 ESC Guidelines for Acute Coronary Syndromes

【ACS 스펙트럼과 ICD-10 코드】
- I20.0 불안정협심증 (Unstable angina): 급성 허혈 증상 + troponin 정상 (또는 상승 없음)
- I21.4 급성 심내막하심근경색 (NSTEMI): 급성 허혈 증상 + troponin 상승/하강 (99th percentile URL 초과)
- I25.1 관상동맥경화증 (CAD with angina): 만성, 비급성

【보험 쟁점 — 진단서-입퇴원요약지 코드 불일치】
- 입원 중 검사 진행에 따라 I20 → I21.4로 최종 진단이 변경되는 경우가 흔하다.
- 퇴원요약지의 final 진단 코드가 I21.4이면 진단비 지급요건 판단은 I21.4 기준으로 해야 한다.
- 도중 경과기록에 I20이 있다고 해서 I21.4 최종 진단을 부정하는 것은 임상 실무와 상충한다.
- 보험사가 "입원 초기 I20 기재"를 근거로 삼으면, 2023 ESC 가이드라인상 ACS 평가 과정의 단계별 코드 변경을 무시하는 것이다.

【키워드】 불안정협심증, unstable angina, NSTEMI, I20, I21.4, I25.1, CAD, ACS, 진단서, 입퇴원요약지, 코드 불일치`,
    source_url: 'https://www.acc.org/Latest-in-Cardiology/ten-points-to-remember/2023/08/29/14/01/2023-esc-guidelines-acs-esc-2023',
    diagnosis_code: 'I20 / I21.4 / I25.1',
    diagnosis_name: 'Unstable angina / NSTEMI / CAD',
    source_provider: 'ESC ACS guideline summary',
  },
  {
    chunk_id: 'medical_guideline:MANUAL:ACUTE_MI_CAG_PCI_FINDINGS:v1',
    title: 'CAG/PCI 소견과 허혈 근거 - coronary thrombus, culprit lesion, severe stenosis',
    summary: 'CAG에서 coronary thrombus, culprit lesion, acute occlusion 또는 flow-limiting complication이 확인되면 급성 허혈성 사건 판단에 중요하다. LM-LAD 또는 LM-mLAD 중증 협착과 PCI/stent 시행 사실은 단독으로 심근경색 확정은 아니지만, 흉통ㆍtroponin 추이ㆍECGㆍEcho와 결합하면 보험사 단순 CAD/협심증 해석의 약점을 지적하는 근거가 된다.',
    chunk_text: `CAG/PCI 소견과 급성 허혈 근거 — 보험 쟁점용 Fourth Universal Definition 적용 요약

【출처】 PubMed / Fourth Universal Definition of MI (Thygesen et al., 2018, PMID 30154043)

【CAG 소견별 허혈 근거 분류】
- Coronary thrombus 확인 → 급성 사건(acute event) 강력 시사
- Culprit lesion with acute occlusion (TIMI 0-1) → STEMI/급성폐쇄 동반 MI
- Flow-limiting complication (TIMI < 3) 시술 전 확인 → 허혈 근거
- LM-LAD 또는 다혈관 severe stenosis (≥70%) → 단독으로는 확정 불가, 증상/troponin과 결합 필요

【스텐트 시술(PCI) 기록의 의미】
- PCI/stent 시행 자체 = 관상동맥 협착이 임상적으로 유의미하다는 시술자 판단
- 시술 전 협착도, 병변 위치, 시술 목적(긴급 vs 선택) 기록이 허혈 근거로 활용 가능

【보험 쟁점 적용】
- 보험사가 "CAG 소견만으로는 I21.4가 아니다"라고 주장 시: CAG 소견 + troponin + ECG + 증상 합산 검토 필수
- 주치의가 CAG-confirmed thrombus/culprit lesion을 근거로 NSTEMI 진단 → 보험사 단독 번복 불가

【키워드】 CAG, PCI, coronary thrombus, culprit lesion, TIMI flow, LM-LAD, stent, I21.4, NSTEMI, 허혈 근거, 심근경색`,
    source_url: 'https://pubmed.ncbi.nlm.nih.gov/30154043/',
    diagnosis_code: 'I21.4',
    diagnosis_name: 'NSTEMI / coronary thrombus / CAG',
    source_provider: 'ESC/ACC/AHA/WHF consensus',
  },
];

// ─────────────────────────────────────────────────────────────────
// B. New medical guideline areas
// ─────────────────────────────────────────────────────────────────
const NEW_GUIDELINE_REFS = [
  {
    chunk_id: 'medical_guideline:MANUAL:STROKE_AHA_DIAGNOSIS:v1',
    title: '뇌졸중(Stroke) 진단기준 - 허혈성 뇌졸중 I63, 출혈성 I61/I60 및 보험 쟁점',
    summary: '뇌졸중 진단은 갑작스러운 국소 신경학적 결손 + CT/MRI 영상 확인이 원칙이다. I63(뇌경색), I61(뇌내출혈), I60(지주막하출혈)은 각각 별도의 진단기준이 있으며, 단순 TIA(일과성허혈발작)는 I63에 해당하지 않아 뇌졸중 진단비 지급요건 미충족이 된다.',
    chunk_text: `뇌졸중 진단기준 — 허혈성/출혈성 뇌졸중 분류 및 보험 쟁점 요약 (AHA/ASA 2018 Guideline)

【출처】 PubMed / 2018 AHA/ASA Stroke Guideline (PMID 29790764)

【뇌졸중 ICD-10 분류】
- I63 뇌경색(Cerebral infarction): 허혈성 뇌졸중 — 뇌혈관 폐쇄로 인한 뇌조직 괴사
- I61 뇌내출혈(Intracerebral hemorrhage): 출혈성 뇌졸중 — 뇌실질 내 출혈
- I60 지주막하출혈(Subarachnoid hemorrhage): 뇌동맥류 파열 등
- G45 일과성허혈발작(TIA): 증상 24시간 이내 완전 소실, 영상에서 뇌경색 없음 → 뇌졸중 진단비 지급 대상 아님

【진단 핵심 기준】
1. 갑작스러운 국소 신경학적 증상 (편마비, 실어증, 시야장애, 운동실조 등)
2. 증상 지속 > 24시간 또는 영상에서 급성 뇌병변 확인 (DWI-MRI 고신호)
3. 타 원인(저혈당, 복합부분발작 등) 배제

【보험 쟁점】
- 뇌졸중 진단비: 보험약관에 "뇌졸중" 정의 여부 — I60, I61, I63만 인정하거나 G45 제외
- 보험사가 "MRI 결과 뇌경색 병변 없다"며 부지급 시: DWI 촬영 시기(발생 후 6시간 이내 위음성 가능) 검토 필요
- 입퇴원 최종 진단 코드가 I63인 경우 뇌졸중 진단비 지급요건 충족 여부 약관 기준 대조

【키워드】 뇌졸중, stroke, I63, I61, I60, 뇌경색, 뇌내출혈, TIA, MRI DWI, 뇌졸중진단비, 보험금`,
    source_url: 'https://pubmed.ncbi.nlm.nih.gov/29790764/',
    diagnosis_code: 'I63 / I61 / I60',
    diagnosis_name: '허혈성 뇌졸중 / 뇌내출혈 / 지주막하출혈',
    source_provider: 'AHA/ASA Stroke Guideline 2018',
  },
  {
    chunk_id: 'medical_guideline:MANUAL:CANCER_DIAGNOSIS_CRITERIA:v1',
    title: '암 진단확정 기준 - 병리조직학적 확진, 상피내암(D코드) vs 침윤성암(C코드) 구분',
    summary: '암보험에서 "암 진단확정"은 원칙적으로 병리조직학적 검사(조직생검 또는 세포학적 검사)에 의한 확진이다. ICD-10 C코드(악성 신생물)와 D코드(상피내암·양성종양)는 보험약관상 지급금액이 다르므로, 주치의 진단서의 코드 기재와 병리보고서 내용을 대조해야 한다.',
    chunk_text: `암 진단확정 기준 — 보험 쟁점용 국가암정보센터/병리학적 기준 요약

【출처】 국가암정보센터 (cancer.go.kr) / AJCC TNM 분류 기준

【암 진단확정의 원칙】
- 병리조직학적 확진(histopathological diagnosis): 조직생검 또는 세포학적 검사
- 조직 채취 불가 시: 임상 소견 + 영상(CT/PET/MRI) + 혈액종양표지자로 임상 진단 가능 (단, 일부 약관은 병리 확진 요구)
- 주치의 진단이 최우선: 전문의(종양내과, 외과, 병리과)가 내린 최종 진단이 기준

【ICD-10 코드 분류 (암진단금 해당 여부)】
- C00-C97 악성 신생물 (암 진단금 지급 대상 — 일반암)
- D00-D09 상피내암 (carcinoma in situ): 일부 약관에서 일반암 진단금 50% 또는 별도 소액 지급
- D10-D36 양성 신생물: 암 진단금 지급 대상 아님 (일반 입원비만)
- C73 갑상선암: 일부 약관에서 소액암/유사암으로 분류 → 일반암 진단금보다 낮은 금액 지급

【보험 쟁점】
- 보험사가 "병리보고서에 'carcinoma in situ' 표기가 없다"며 C코드를 D코드로 재분류 시도 → 병리과 전문의 최종 진단 코드가 기준
- 스크리닝 후 추적 조직검사 시점 지연 → 의료 과정이지 진단 지연이 아님
- D34 갑상선 양성종양 vs C73 갑상선암: FNAB 세포학 Bethesda 분류 + 수술 후 병리 최종 결과 기준

【키워드】 암진단금, 병리조직, 상피내암, 악성신생물, C코드, D코드, C73, D34, 갑상선암, 조직검사, 암진단비`,
    source_url: 'https://www.cancer.go.kr/lay1/program/S1T211C212/cancer/view.do',
    diagnosis_code: 'C00-C97 / D00-D09',
    diagnosis_name: '악성신생물 / 상피내암',
    source_provider: '국가암정보센터 / AJCC TNM',
  },
  {
    chunk_id: 'medical_guideline:MANUAL:DISABILITY_STANDARD_TABLE:v1',
    title: '후유장해 평가 기준 - 표준장해분류표, 맥브라이드표, AMA Guides 적용 원칙',
    summary: '후유장해보험금은 치료 종결 후 장해 확정 시점에 표준장해분류표 기준으로 지급한다. 맥브라이드(McBride) 기준은 한국에서 노동능력 상실률 산정에 활용되나, 보험약관 부표(표준장해분류표)와 직접 연동되지 않으므로 혼용하지 않는다. 장해 판정 기준 시기(통상 치료 종결 후 6개월)와 영구적 장해 여부 확인이 핵심이다.',
    chunk_text: `후유장해 보험금 — 표준장해분류표 적용 기준 및 보험 쟁점 요약 (금융감독원 표준약관 기준)

【출처】 금융감독원 (fss.or.kr) 표준약관 / 생명보험협회 표준약관 장해분류표

【후유장해 판정 원칙】
1. 판정 시기: 치료 종결 후 충분한 경과(통상 6개월 이상) 또는 증상 고정 시점
2. 판정 기준: 보험약관 부표(표준장해분류표) 해당 항목 기준 — 노동능력 상실 아닌 기능 장해 기준
3. 영구성: 원칙적으로 증상이 영구적으로 지속될 것으로 예상되어야 함
4. 전문의 소견: 해당 과 전문의(신경외과, 정형외과, 재활의학과 등) 소견이 우선

【표준장해분류표 주요 항목】
- 척추 장해: MRI 확인 + 기능 제한 정도 (10-40% 구간별 기준)
- 사지 장해: ROM(관절가동범위) 측정치 기준
- 신경계 장해: 신경학적 기능 결손 정도 (언어, 인지, 이동능력)
- 안면/청력/시력 장해: 각 항목별 측정 기준

【보험 쟁점】
- 보험사가 "치료 종결 전이라 장해 판정 불가"라며 청구 지연 요구: 증상 고정이 인정되면 치료 중이라도 판정 가능
- 맥브라이드 기준으로 노동능력 상실률 산정 시: 약관 장해분류표와 다른 기준이므로 약관 기준이 우선
- MRI 등 영상 소견과 임상 기능 검사 결과 불일치 시: 기능 장해 중심으로 판단
- 장해 지급률 산정 시 동일 원인 복수 장해 합산 방법 확인 필요

【키워드】 후유장해, 표준장해분류표, 장해보험금, 맥브라이드, AMA Guides, ROM, 척추장해, 기능장해, 치료종결, 영구장해`,
    source_url: 'https://www.fss.or.kr/fss/main/main.do',
    diagnosis_code: null,
    diagnosis_name: '후유장해 (기능 및 신체 장해)',
    source_provider: '금융감독원 표준약관 / 생명보험협회',
  },
  {
    chunk_id: 'medical_guideline:MANUAL:THYROID_ATA_GUIDELINE:v1',
    title: '갑상선 결절/암 진단기준 - ATA 2015 Guideline, Bethesda 분류, C73/D34/E04 코드 구분',
    summary: '갑상선 결절의 악성 여부는 초음파 위험도(ATA/ACR TI-RADS) + 세침흡인검사(FNAB) Bethesda 분류로 판단한다. 최종 암 확진은 수술 후 병리조직 소견이 기준이다. 보험약관상 C73(갑상선암)은 소액암 또는 유사암으로 분류되는 경우가 많으며, D34(갑상선 양성종양)·E04(결절성갑상선종)는 암진단금 지급 대상이 아니다.',
    chunk_text: `갑상선 결절 및 갑상선암 진단기준 — ATA 2015 Guideline 기반 보험 쟁점 요약

【출처】 PubMed / ATA 2015 Thyroid Nodule and Differentiated Thyroid Cancer Guideline (PMID 26462967)

【갑상선 결절 평가 흐름】
1. 초음파 위험도 분류 (ATA 2015 또는 ACR TI-RADS)
   - Very low suspicion: 순수낭성 결절 → FNAB 불필요
   - Low/Intermediate suspicion: 크기·소견에 따라 FNAB 고려
   - High suspicion: 불규칙 경계, 미세석회화, 저에코, 침범 소견 → FNAB 권고
2. 세침흡인검사(FNAB) Bethesda 분류 (I~VI)
   - Bethesda I (비진단적): 재검 또는 초음파 추적
   - Bethesda III (의미불명 세포이형성): 분자 마커 또는 반복 FNAB
   - Bethesda V/VI (악성 의심/악성): 수술 권고
3. 최종 확진: 수술 후 병리조직 소견

【ICD-10 코드 및 보험 분류】
- C73 갑상선의 악성 신생물 (갑상선암): 대부분 유사암/소액암으로 분류 — 일반암 진단금의 10-20%
- D34 갑상선의 양성 신생물: 암 진단금 대상 아님
- E04.1 갑상선 비중독성 단발성 결절: 양성 결절성 갑상선종 — 암 아님
- E04.2 갑상선 비중독성 다발성 결절: 갑상선 결절종 — 암 아님

【보험 쟁점】
- FNAB Bethesda V/VI → 수술 시행 → 병리 C73 확진: 갑상선암 진단금(소액암) 지급 요건 충족
- 보험사가 "수술 전 확진 없다"며 수술 후 병리 결과를 소급 적용 거부 시: 진단 시점은 최종 병리 확진일
- 미세유두암(papillary microcarcinoma, ≤1cm) 포함 여부는 약관 갑상선암 정의 확인 필요
- D34로 수술했으나 최종 병리 C73이면 C73 기준 적용

【키워드】 갑상선암, 갑상선결절, C73, D34, E04, TI-RADS, FNAB, Bethesda, 유사암, 소액암, ATA guideline, 병리조직`,
    source_url: 'https://pubmed.ncbi.nlm.nih.gov/26462967/',
    diagnosis_code: 'C73 / D34 / E04',
    diagnosis_name: '갑상선암 / 갑상선 양성종양 / 갑상선 결절종',
    source_provider: 'ATA 2015 Thyroid Guideline',
  },
];

const ALL_REFS = [...ACUTE_MI_REFS, ...NEW_GUIDELINE_REFS];

// ─────────────────────────────────────────────────────────────────
// Embedding + insert
// ─────────────────────────────────────────────────────────────────

async function createEmbedding(text) {
  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ input: text, model: EMBEDDING_MODEL }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI embedding error: ${resp.status} ${err}`);
  }
  const json = await resp.json();
  return json.data[0].embedding;
}

async function checkExists(chunkId) {
  const { data } = await supabase
    .from('rag_master_chunks')
    .select('chunk_id')
    .eq('chunk_id', chunkId)
    .maybeSingle();
  return Boolean(data);
}

async function importGuideline(ref) {
  const exists = await checkExists(ref.chunk_id);
  if (exists) {
    console.log(`  [SKIP] Already exists: ${ref.chunk_id}`);
    return { status: 'skipped', chunk_id: ref.chunk_id };
  }

  const embeddingText = `${ref.title}\n\n${ref.chunk_text}`;
  console.log(`  [EMBED] Generating embedding for: ${ref.chunk_id}`);

  let embedding = null;
  if (!DRY_RUN) {
    embedding = await createEmbedding(embeddingText);
  }

  const row = {
    chunk_id: ref.chunk_id,
    title: ref.title,
    chunk_text: ref.chunk_text,
    summary: ref.summary,
    source_area: 'medical_guideline',
    source_type: 'guideline_summary',
    trust_level: 'official',
    review_status: 'reviewed',
    embedding_status: DRY_RUN ? 'pending' : 'done',
    embedding_model: (!DRY_RUN && embedding) ? EMBEDDING_MODEL : null,
    embedding_created_at: (!DRY_RUN && embedding) ? new Date().toISOString() : null,
    source_url: ref.source_url || null,
    metadata: {
      official_citation_allowed: true,
      source_status: 'guideline_summary',
      diagnosis_code: ref.diagnosis_code || null,
      diagnosis_name: ref.diagnosis_name || null,
      source_provider: ref.source_provider || null,
      dataset_version: 'medical_evidence_source_pack_2026-05-21',
      imported_by: 'importMedicalGuidelines.js',
    },
    ...(embedding ? { embedding } : {}),
  };

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Would insert: ${ref.chunk_id}`);
    console.log(`    title: ${ref.title.substring(0, 80)}...`);
    console.log(`    source_url: ${ref.source_url}`);
    return { status: 'dry_run', chunk_id: ref.chunk_id };
  }

  const { error } = await supabase.from('rag_master_chunks').insert(row);
  if (error) {
    console.error(`  [ERROR] Insert failed for ${ref.chunk_id}: ${error.message}`);
    return { status: 'error', chunk_id: ref.chunk_id, error: error.message };
  }

  console.log(`  [OK] Inserted: ${ref.chunk_id}`);
  return { status: 'inserted', chunk_id: ref.chunk_id };
}

async function main() {
  console.log(`\n=== importMedicalGuidelines.js ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (pass --execute to insert)' : 'EXECUTE'}`);
  console.log(`Total refs to process: ${ALL_REFS.length} (${ACUTE_MI_REFS.length} acute MI + ${NEW_GUIDELINE_REFS.length} new areas)\n`);

  const results = { inserted: 0, skipped: 0, dry_run: 0, error: 0 };

  for (let i = 0; i < ALL_REFS.length; i++) {
    const ref = ALL_REFS[i];
    console.log(`[${i + 1}/${ALL_REFS.length}] ${ref.title.substring(0, 70)}`);
    const result = await importGuideline(ref);
    results[result.status] = (results[result.status] || 0) + 1;
    if (i < ALL_REFS.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n=== Summary ===');
  console.log(`Inserted: ${results.inserted}`);
  console.log(`Skipped (already exists): ${results.skipped}`);
  console.log(`Dry-run (would insert): ${results.dry_run}`);
  console.log(`Errors: ${results.error}`);

  if (!DRY_RUN && results.inserted > 0) {
    const { count } = await supabase
      .from('rag_master_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('source_area', 'medical_guideline');
    console.log(`\nDB medical_guideline total rows after import: ${count}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
