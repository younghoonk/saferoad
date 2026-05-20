# SafeRoad 프로젝트 종합 품질 점검 보고서

**작성일:** 2026-05-21  
**점검 범위:** rag-datasets-staging 브랜치 기준 전체 코드베이스  
**점검자:** Claude Code (Sonnet 4.6)

---

## 1단계: 구조 파악

### 1.1 프로젝트 폴더 구조

```
saferoad/
├── src/                          # React Native/Expo 앱 소스
│   ├── screens/                  # 화면 (AdjusterHome, AIAnalysis, Chat 등)
│   ├── lib/                      # API 클라이언트 (assessmentDraftApi, ragReferences 등)
│   ├── contexts/AuthContext.tsx  # 인증 컨텍스트
│   └── navigation/AppNavigator.tsx
├── supabase/
│   ├── functions/                # Edge Functions (14개)
│   │   ├── _shared/
│   │   │   ├── ragSearch.ts      # ★ RAG 파이프라인 핵심
│   │   │   ├── detectAssessmentProfile.ts
│   │   │   ├── filterAssessmentReferences.ts
│   │   │   └── medicalGuidelineEvidence.ts
│   │   ├── create-assessment-draft/index.ts  # ★ 사정서 생성 (285KB)
│   │   ├── analyze-document/
│   │   ├── create-closing-report/
│   │   └── (기타 문서 처리 함수들)
│   └── migrations/               # 스키마 마이그레이션 (16개)
├── scripts/                      # 데이터 파이프라인 스크립트 (40+개)
├── ai_eval/                      # 평가 데이터셋
│   ├── assessment_cases_100_v1.json   # 100건 baseline
│   ├── gold_answers/
│   └── results/assessment_eval_latest.md  # 현재 eval 결과
└── test-output/                  # 실제 생성된 사정서 샘플
```

### 1.2 사용 중인 모델 및 설정

| 항목 | 값 | 위치 |
|------|-----|------|
| 임베딩 모델 | `text-embedding-3-small` | `ragSearch.ts:1` |
| 임베딩 차원 | 1536 | `migrations/.../create_rag_tables.sql:263` |
| LLM 모델 | `gpt-4o` | `create-assessment-draft/index.ts:296` |
| max_tokens | 6000 | `create-assessment-draft/index.ts:1114` |
| MIN_SIMILARITY | **0.45** (threshold) | `ragSearch.ts:3` |
| RPC 기본값 | 0.65 | `create_rag_tables.sql:332` |

**⚠️ 주의:** ragSearch.ts의 MIN_SIMILARITY(0.45)가 RPC 기본값(0.65)보다 낮게 설정되어 검색 노이즈 위험.

### 1.3 RAG 파이프라인 위치

- **검색 엔진:** `supabase/functions/_shared/ragSearch.ts`
- **RPC 함수:** `match_rag_master_chunks` (PostgreSQL pgvector cosine similarity)
- **검색 플랜:** 12개 source_area 병렬 검색, area별 count*4 (최소 10)건 조회 후 재정렬

```
query → text-embedding-3-small → vector(1536)
      → 12개 source_area 병렬 RPC → 각 최대 40건
      → enrichRows() (metadata 보강)
      → scoreRow() (가중치 재정렬)
      → directlyRelevantOfficial/Internal() 필터
      → area별 상위 2-3건 선택
```

---

## 2단계: Supabase 데이터 품질 점검

### 2.1 rag_master_chunks 테이블 스키마

```sql
CREATE TABLE rag_master_chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id        text NOT NULL UNIQUE,
  source_area     text NOT NULL CHECK (source_area IN (
    'precedents', 'terms_standards', 'fss_dispute_cases',
    'medical_knowledge', 'legal_statutes', 'issue_playbooks',
    'medical_issue_codes', 'real_case_patterns', 'real_case_documents',
    'practice_playbooks', 'dispute_resolution_cases', 'medical_guideline'
  )),
  source_type     text,
  title           text NOT NULL,
  chunk_text      text NOT NULL,
  summary         text,                  -- ← 선택적
  keywords        text,                  -- ← 선택적
  source_url      text,                  -- ← 선택적
  trust_level     text,                  -- ← 선택적, 공식인용 판단 핵심
  review_status   text DEFAULT 'unreviewed',
  embedding       vector(1536),          -- ← text-embedding-3-small
  metadata        jsonb DEFAULT '{}',    -- ← release_stage, official_citation_allowed 등
  effective_from  date,                  -- ← 선택적
  effective_to    date                   -- ← 선택적
);
```

**관련 원본 테이블:**

| 테이블 | 특이사항 |
|--------|----------|
| `court_precedents` | case_number, court_or_agency, decision_date 모두 선택적 |
| `fss_dispute_cases` | source_status 필드 포함 (title_seed_needs_full_text 판별용) |
| `terms_raw_chunks` | page_no + chunk_no → 페이지/문단 단위 청킹 |

### 2.2 DB 직접 접근 불가 — 코드 분석 기반 데이터 품질 추론

> ⚠️ `.env.rag.local` 파일이 없어 Supabase에 직접 쿼리할 수 없었습니다. 아래는 마이그레이션 파일, 스크립트 코드, 필터링 로직으로 추론한 데이터 품질입니다.

#### 메타데이터 누락률 (추론)

| 필드 | 위험도 | 근거 |
|------|--------|------|
| `trust_level` | 높음 | 선택적 필드. 미설정 시 `isOfficialReference()` 판단에서 `unreviewed` 취급 → 공식 인용 불가 |
| `review_status` | 높음 | default='unreviewed'. `strongPrecedentCitation()`이 FALSE → 판례 공식 인용 불가 |
| `official_citation_allowed` | 높음 | metadata JSON 안에 있어 누락 시 `officialCitationAllowed()` = false |
| `release_stage` | 중간 | metadata 안. 누락 시 'active'로 간주 (안전) |
| 판례 case_number | 높음 | `court_precedents.case_number`가 optional → 사정서에서 판례번호 인용 불가 |
| FSS 분쟁조정례 원문 | 높음 | `source_status='title_seed_needs_full_text'` 건은 제목만 있고 내용 없음. ragSearch.ts에서 특별 필터로 제외 |

#### 청킹 단위 분석

- **약관 (`terms_raw_chunks`)**: `page_no` + `chunk_no` 구조 → 페이지 단위 청킹 (적절)
- **판례 (`court_precedents`)**: 판례 전체가 1 row (full_text_excerpt 별도). rag_master_chunks로 동기화 시 전체 텍스트가 1 chunk → **1536차원 압축 한계**, 세부 법리 검색 정밀도 저하
- **금감원 분쟁조정례 (`fss_dispute_cases`)**: title_seed 상태 건들은 summary만 있어 실제 내용 없음

#### 임베딩 모델 평가

- `text-embedding-3-small`: 비용 절감형 모델. 한국어 법률/의료 도메인 특화 미흡
- 동의어 처리: "I21.4 ↔ NSTEMI ↔ 급성 심내막하심근경색증"의 시맨틱 매핑이 약할 가능성 있음
- 벡터 차원: 1536 (ada-002 동일, text-embedding-3-large의 절반 수준)

---

## 3단계: RAG 검색 실측

> DB 직접 접근 불가로 실제 쿼리를 실행하지 못하고, 코드 분석 + 아키텍처 기반으로 예측합니다.

### 3.1 검색 플랜 구성

```
source_area           | count | section
----------------------|-------|--------
legal_statutes        |   3   | official
terms_standards       |   3   | official
fss_dispute_cases     |   3   | official
dispute_resolution    |   3   | internal
precedents            |   3   | official
medical_guideline     |   3   | internal
medical_knowledge     |   3   | internal
medical_issue_codes   |   3   | internal
issue_playbooks       |   2   | internal
practice_playbooks    |   2   | internal
real_case_patterns    |   2   | internal
real_case_documents   |   2   | internal
```

### 3.2 5개 테스트 쿼리 예측 분석

**(1) "급성 심내막하심근경색증 I21.4 트로포닌 미상승 NSTEMI 보험금 부지급"**

- `heartDiagnosisQuery()` 감지 ✅ → 심장 관련 chunk 점수 +0.14~0.22
- I21.4 코드 추출 → `exactCodeMatches()` 보너스 +0.12
- practice_playbooks에 암호화된 심장 플레이북 존재 가능
- **예상 정확도:** 중-상 (심장 관련 플레이북/의료지식 검색 잘 됨)
- **취약점:** FSS 분쟁조정례 원문이 없으면 공식 근거 섹션 빈약

**(2) "관상동맥 PCI 시술 후 보험금 분쟁"**

- `heartDiagnosisQuery()` 감지 ✅ (PCI, 관상동맥)
- 진단 코드 없음 → exactCodeMatches 보너스 없음
- 쿼리가 광범위해서 관련성 낮은 문서 포함 가능
- **예상 정확도:** 중 (심장 관련이지만 코드 미지정으로 정밀도 낮음)

**(3) "대법원 2013다208661 진단확정 요건"**

- 특정 판례번호 → precedents에서 case_number 매칭 기대
- `strongPrecedentCitation()` 기준: source_status='official_law_api_full_text' OR (reviewed + citation_allowed)
- 해당 판례가 importKoicdPrecedents로 가져왔다면 있을 수 있음
- **예상 정확도:** 낮음~중간 (판례 DB 커버리지에 전적으로 의존)
- **핵심 위험:** 판례번호는 있지만 unreviewed → internal 자료로 분류 → 공식 인용 불가

**(4) "허혈성 심장질환 진단 약관 분쟁조정"**

- `heartDiagnosisQuery()` 부분 감지 (협심증/I20 키워드 없음)
- terms_standards + fss_dispute_cases 검색
- 허혈성 심장질환 약관 terms_raw_chunks에 있으면 관련 결과 반환
- **예상 정확도:** 중 (약관은 있으나 분쟁조정례 원문 없으면 한계)

**(5) "보험금 부지급 의료자문 판례"**

- 특정 질병코드 없음, 광범위 쿼리
- `diagnosisCodes` = [] → exactCodeMatches 없음, hasSimilarButNotExactCode 없음
- 관련성 낮은 문서도 MIN_SIMILARITY 0.45 이상이면 포함
- **예상 정확도:** 낮음 (노이즈 많을 것)

### 3.3 검색 정확도가 낮을 경우 원인 가설 3개

**가설 1: FSS·판례 원문 커버리지 부족 (최고 가능성)**
- `fss_dispute_cases`의 title_seed 건들은 제목만 있고 실제 결정문 없음
- `court_precedents` 대부분이 `review_status='unreviewed'` → officialReferences 목록이 항상 빈약
- 증거: ragSearch.ts 곳곳에 title_seed 필터, unreviewed 조건 분기가 촘촘히 있음

**가설 2: 임베딩 모델의 한국어 법률 도메인 시맨틱 한계 (중간 가능성)**
- text-embedding-3-small은 범용 모델
- "I21.4"와 "심내막하심근경색증"이 서로 다른 벡터 공간에 위치할 수 있음
- "관상동맥조영술"과 "CAG"의 시맨틱 유사도가 낮을 수 있음
- 대책: 쿼리 시 동의어 확장, 또는 text-embedding-3-large 전환 검토

**가설 3: 단일 threshold 0.45가 source_area별 최적값과 불일치 (낮은 가능성)**
- 법령(legal_statutes)은 0.5 이상이어야 적절할 수 있음
- 의료지식(medical_knowledge)은 0.4도 허용될 수 있음
- 단일 threshold → 일부 source_area에서 노이즈 과다 또는 과소 검색
- 증거: 원래 RPC 기본값이 0.65인데 0.45로 낮춘 이유가 데이터 부족을 보완하기 위한 것으로 추정

---

## 4단계: 사정서 출력 샘플 평가

### 4.1 샘플 위치

- **유일한 완성 샘플:** `test-output/i214_assessment_draft_test_a0b01d7b-a10b-49fd-8955-8799ee73bdeb.md`
- **케이스:** I21.4 급성 심내막하심근경색증, PCI/stent, hs-troponin T 0.037
- **형식:** 구형 JSON 섹션 방식 (overview/facts/issues/... 분리)
- **최신 eval 결과:** `ai_eval/results/assessment_eval_latest.md` — **1건 FAIL**

### 4.2 체크리스트 채점 (I21.4 샘플 기준)

| 항목 | 결과 | 상세 |
|------|------|------|
| ☐ 보험사 부지급 사유 원문 「」 인용 | ❌ 미충족 | "보험사 안내문상 I25.1 죽상경화성 심장병은 인정 가능" — 원문 아님, 「」 없음 |
| ☐ 국제 진단기준 명시 | ❌ 미충족 | AHA/ESC "Fourth Universal Definition of MI 2018" 명시 없음 |
| ☐ 진단기준 vs 환자데이터 매핑표 | ❌ 미충족 | 표 형식 없음 |
| ☐ 약관 조항 원문 인용 + 항목별 충족표 | ❌ 미충족 | "가입 당시 약관" 언급만, 원문·충족표 없음 |
| ☐ 보험사 인용 판례 역공 구조 | ❌ 미충족 | 판례 인용 및 역공 없음 |
| ⚠️ 의무기록 킬링 에비던스 발굴 | 부분 | hs-troponin T 0.037, PCI 언급 있으나 별도 강조 없음 |
| ❌ 다중 방어선 4개 이상 | ❌ 미충족 | 의학적 판단 + 절차적 주장 2개 수준 |
| ❌ 약한 어미 없음 | ❌ 실패 | "검토 가치가 있습니다", "필요합니다", "확정할 수는 없으나" 다수 |
| ⚠️ 결론·요청사항 3종 | 부분 | 지연이자 요청 없음, 서면회신 요청 있음 |

**총평: 9개 항목 중 0개 완전 충족, 2개 부분 충족**

### 4.3 구형 포맷 vs. 신형 포맷 불일치 문제

- 테스트 샘플은 **구형 JSON 섹션 포맷** (title/overview/facts/issues/...)으로 출력됨
- 현재 코드는 `finalSubmissionAssessmentReport` (submission_report_v2_claim_argument_structure) 포맷을 사용
- `selfVerifySubmissionReport()` + `repairSubmissionReport()` self-healing 구조가 새로 추가됨
- **현재 샘플이 최신 코드 결과를 반영하지 않아 품질 평가의 신뢰도 제한적**

### 4.4 eval 결과 분석

```
# ai_eval/results/assessment_eval_latest.md
- Total: 1 / Pass: 0 / Fail: 1
- ASSESS_001: FORBIDDEN_PHRASE_FAIL
- forbidden submission internals: confidence/document_type/completed/file marker/date placeholder
- forbidden argument wording: /\[일자 확인\]/g
```

- `[일자 확인]` 플레이스홀더가 gpt-4o 출력에 포함됨
- `enforceSubmissionReportContract()`에서 `/\[일자\s*확인\]/g` 패턴 제거 시도하지만 eval에서 감지됨
- **가능 원인:** eval이 postprocess 전 raw output을 검사하거나, regex 패턴이 실제 출력과 불일치

---

## 5단계: 종합 진단서

### 병목 1 (어려움): RAG 공식 데이터 커버리지 부족

**현상:**
- `officialReferences` 섹션이 대부분 비어 있거나 fallback 항목으로 채워짐
- FSS 분쟁조정례 상당수가 `title_seed_needs_full_text` 상태 (원문 없음)
- 판례 대부분 `review_status='unreviewed'` → `strongPrecedentCitation()` false → 공식 인용 불가

**코드상 근본 원인:**
- `ragSearch.ts:422-436`: `isOfficialReference()` 판례 조건 = `strongPrecedentCitation()` 또는 `isTrustedTermsReference()` 만족 필요
- `ragSearch.ts:399-407`: `strongPrecedentCitation()` = `source_status='official_law_api_full_text'` OR (`reviewed` + `official_citation_allowed`)
- 대부분 판례가 두 조건 모두 미충족 → `internalReviewMaterials`(내부 검토자료)로 분류

**영향:**
- 사정서에 "공식 근거" 없이 "내부 검토자료"만 제시 → 설득력 저하
- LLM에 공식 근거 미제공 → "직접 관련 공식 근거 부족" 출력 → 실제 사정서 품질 최저

**해결 방향:**
1. `importKoicdPrecedents.js` + `importFssLatestCases.js` 주기적 실행으로 원문 확보
2. 원문 확보된 판례는 `review_status='reviewed'`, `official_citation_allowed=true` 수동 업데이트
3. FSS 분쟁조정례 원문 PDF OCR 파이프라인 완성 (e2eGoogleDocumentAi 스크립트 활용)

---

### 병목 2 (중간): selfVerificationPasses()가 I21.4 케이스에 hardcode됨

**현상:**
- `selfVerifySubmissionReport()` 함수가 심장/I21.4 케이스 전용 regex로만 성공 여부를 판단
- 비심장 케이스(고지의무, 암보험, 실손 등)에서 `medicalStandardNamed`, `medicalMappingTablePresent`, `killingEvidencePresent` 항상 false
- → `selfVerificationPasses()` = false → `repairSubmissionReport()` 항상 호출
- → repair 내부에 심장 전용 내용 추가 → 비심장 케이스에 심근경색 내용 삽입 가능

**코드상 근본 원인 (index.ts:1588-1602):**
```typescript
medicalStandardNamed: /Fourth Universal Definition of Myocardial Infarction|NSTEMI|I21\.?4/i.test(text),
killingEvidencePresent: argument.killingEvidence.length > 0 && 
  /cardiac marker|EKG|UA-?NSTEMI|troponin/i.test(text),
```

비심장 케이스에서 위 regex가 절대 true가 될 수 없음.

**repairSubmissionReport() 추가 내용 (index.ts:1636-1639):**
```typescript
'Fourth Universal Definition of Myocardial Infarction 2018은 troponin rise/fall...',
'| 진단기준 | 환자 자료 | 판단 |'
```
→ 고지의무 위반 사건에 심근경색 기준표가 삽입될 수 있음

**해결 방향:**
- `selfVerifySubmissionReport()`와 `repairSubmissionReport()`에 profile 파라미터 추가
- 심장 케이스에만 `medicalStandardNamed` / `killingEvidencePresent` 체크 적용
- 다른 프로파일에는 프로파일별 verification 기준 구현 필요

```typescript
// 개선 예시
function selfVerifySubmissionReport(
  report: string,
  argument: ClaimArgumentStructure,
  preAnalysis: PreAnalysisResult,
  profile: AssessmentProfileId,  // ← 추가
) {
  const isHeart = profile === 'heart_diagnosis_benefit' || profile === 'acute_mi_denial';
  return {
    medicalStandardNamed: isHeart
      ? /Fourth Universal Definition|NSTEMI|I21\.?4/i.test(text)
      : true,  // 비심장은 체크 생략
    ...
  };
}
```

---

### 병목 3 (쉬움): 평가 파이프라인 현재 1건 FAIL, baseline 동기화 필요

**현상:**
- `assessment_eval_latest.md`: Pass 0 / Fail 1 (FORBIDDEN_PHRASE_FAIL)
- `ASSESSMENT_BASELINE.md`: "100 PASS / 0 FAIL confirmed" — **stale 상태**
- `enforceSubmissionReportContract()`의 금지 표현 목록과 eval의 `FORBIDDEN_PHRASE` 체크 목록이 불일치

**코드상 근본 원인:**
- `enforceSubmissionReportContract()` 패턴 목록 (index.ts:1450-1466):
  ```
  /\[일자\s*확인\]/g  ← 있음
  ```
- eval에서 감지된 패턴:
  ```
  forbidden argument wording: /\[일자 확인\]/g  ← 동일
  ```
- **원인:** gpt-4o가 생성한 `[일자 확인]` 플레이스홀더가 `customerSideAssessmentReport` 또는 `adjusterOpinionDraft` 등 다른 필드에 있고, `enforceSubmissionReportContract()`는 `finalSubmissionAssessmentReport` 필드에만 적용됨

**해결 방향:**
1. eval 재실행으로 현재 상태 확인: `npm run ai:assessment:eval -- --case ASSESS_001`
2. `forbiddenPhrase` 정규식을 `sanitizeResult()` 함수에도 확장 적용
3. 100건 baseline 재검증 및 ASSESSMENT_BASELINE.md 업데이트

---

## 종합 우선순위 정리

| 순위 | 병목 | 난이도 | 예상 효과 |
|------|------|--------|-----------|
| 1 | FSS·판례 원문 데이터 확보 | 어려움 | 사정서 공식 근거 섹션 충실화, 설득력 대폭 향상 |
| 2 | selfVerification cardiac hardcode 수정 | 중간 | 비심장 케이스 사정서에 심근경색 내용 삽입 방지 |
| 3 | eval 파이프라인 1건 FAIL 수정 | 쉬움 | baseline 신뢰성 회복, CI 회귀 방지 |

---

## 추가 관찰 사항

### A. MIN_SIMILARITY 0.45 정책 위험

- 의도: 데이터 부족을 보완하기 위해 임계값 낮춤
- 위험: 관련성 낮은 문서가 다량 포함 → directlyRelevant 필터가 최후 방어선
- 권장: 데이터가 충분해지면 source_area별로 임계값 차별화 (법령 0.55, 의료지식 0.42 등)

### B. gpt-4o max_tokens 6000 제약

- 복잡한 사정서 (9개 챕터 + 매핑표 + 요청사항)는 6000 토큰으로 truncation 위험
- `composeSubmissionAssessmentReport()` 출력이 잘릴 경우 `parseJsonResponse()`에서 오류 발생 가능
- 권장: 복잡 케이스는 max_tokens 8000-10000으로 증가, 또는 챕터별 분할 호출

### C. piiRedacted 검증 로직 과도한 요건

- `selfVerifySubmissionReport()` piiRedacted 체크:
  ```typescript
  piiRedacted: !/주민번호/i.test(text) && /\[피보험자\]|\[주민번호\]/.test(text)
  ```
- `[피보험자]` 마스킹 문자열이 출력에 없으면 항상 false → self-verification 실패 → repair 유발
- 실제 사정서에 `[피보험자]` 표현이 없는 경우 정상인데도 검증 실패로 처리됨

### D. 평가 커버리지 부족

- `ai_eval/assessment_cases_cancer_claim_40_v1.json`, `assessment_subset_core_10.json` 존재하지만 현재 eval에 포함 안 됨
- 암보험 케이스 40건, 실손 케이스 10건이 eval에서 누락 → baseline에 미반영

---

*본 보고서는 DB 직접 접근 없이 코드베이스 분석으로 작성되었습니다. 실제 데이터 품질 수치는 `scripts/checkRagData.js`, `scripts/checkRagEmbeddings.js`, `scripts/auditRagReleaseState.js`를 실행하여 확인해야 합니다.*
