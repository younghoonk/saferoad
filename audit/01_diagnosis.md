# SafeRoad 1단계 진단 보고서

작성일: 2026-05-21  
점검 브랜치: `rag-datasets-staging`  
점검자: Claude Code (Sonnet 4.6)  
DB 직접 접근 여부: 불가 (`.env.rag.local` 미제공) — 코드·마이그레이션·스크립트 분석 기반

---

## 1단계: 구조 점검

### 1.1 핵심 모델 및 설정

| 항목 | 값 | 파일 |
|------|-----|------|
| 임베딩 모델 | `text-embedding-3-small` | `_shared/ragSearch.ts:1` |
| 임베딩 차원 | 1536 | `migrations/20260504_create_rag_tables.sql:263` |
| LLM | `gpt-4o` | `create-assessment-draft/index.ts:296` |
| max_tokens | 6000 | `create-assessment-draft/index.ts:1114` |
| MIN_SIMILARITY | **0.45** | `_shared/ragSearch.ts:3` |
| RPC 기본 임계값 | 0.65 | `migrations/20260504_create_rag_tables.sql:332` |
| REPORT_FORMAT_VERSION | `submission_report_v2_claim_argument_structure` | `create-assessment-draft/index.ts:297` |

**⚠️ MIN_SIMILARITY 0.45는 RPC 기본값 0.65보다 현저히 낮다.** 데이터 부족 보완 목적으로 낮춘 것으로 추정되나, 관련성 낮은 문서가 다량 포함될 수 있다.

### 1.2 RAG 파이프라인 아키텍처

```
입력 쿼리
  → text-embedding-3-small (1536d 벡터 생성)
  → match_rag_master_chunks RPC (12개 source_area 병렬 호출, 각 count*4 또는 최소 10건)
  → enrichRows() — metadata 보강 (trust_level, review_status, official_citation_allowed)
  → scoreRow() — 진단코드·도메인·질환 특화 가중치 적용 재정렬
  → directlyRelevantOfficial() / directlyRelevantInternal() 필터
  → source_area별 2-3건 선택
  → formatRagForPrompt() — LLM 입력 프롬프트 구성
```

### 1.3 사정서 생성 파이프라인

```
입력 (caseId, insurerPosition, customerStatement, sourceAnalysis, ...)
  → detectAssessmentProfile() — 케이스 프로파일 결정
  → appendMedicalGuidelineEvidence() — acute MI 의학 가이드라인 보강
  → searchRagReferences() — RAG 검색
  → buildDraftPrompt() → callOpenAI() — 초안 JSON 생성
  → buildFinalSubmissionAssessmentReport()
      → buildClaimArgumentStructure()
      → buildPreAnalysisResult()
      → composeSubmissionAssessmentReport()
      → enforceSubmissionReportContract() — 금지표현 제거
      → selfVerifySubmissionReport()  ← ⚠️ I21.4 하드코딩 문제
      → (실패 시) repairSubmissionReport()
  → sanitizeResult() — PII/내부ID 제거
```

### 1.4 source_area 분류 체계 (현행)

| source_area | 공식 인용 가능? | 비고 |
|-------------|----------------|------|
| `legal_statutes` | ✅ | 항상 공식 |
| `terms_standards` | 조건부 | `isTrustedTermsReference()` 통과 시만 |
| `fss_dispute_cases` | 조건부 | `source_status='official_fss_full_text'`만 |
| `precedents` | 조건부 | `strongPrecedentCitation()` 통과 시만 |
| `medical_guideline` | 조건부 | `reviewed` + `official_citation_allowed` 필요 |
| `dispute_resolution_cases` | ❌ | 항상 내부 검토자료 |
| `medical_knowledge` | ❌ | 항상 내부 검토자료 |
| `medical_issue_codes` | ❌ | 항상 내부 검토자료 |
| `issue_playbooks` | ❌ | 항상 내부 검토자료 |
| `practice_playbooks` | ❌ | 항상 내부 검토자료 |
| `real_case_patterns` | ❌ | 항상 내부 검토자료 |
| `real_case_documents` | ❌ | 항상 내부 검토자료 |

---

## 2단계: 데이터 품질

### 2.1 rag_master_chunks 스키마 (마이그레이션 기반)

```sql
-- 중요 필드 발췌
id              uuid PRIMARY KEY
chunk_id        text NOT NULL UNIQUE
source_area     text NOT NULL CHECK (...)
title           text NOT NULL
chunk_text      text NOT NULL
summary         text                    -- 선택적
keywords        text                    -- 선택적
trust_level     text                    -- 선택적, 공식인용 핵심 판단 필드
review_status   text DEFAULT 'unreviewed'
official_citation_allowed (metadata JSON 안)   -- ⚠️ 구조적 취약 위치
release_stage  (metadata JSON 안)               -- ⚠️ 구조적 취약 위치
embedding       vector(1536)
effective_from  date                    -- 선택적
effective_to    date                    -- 선택적
```

### 2.2 메타데이터 누락 위험도

| 필드 | 위험도 | 영향 |
|------|--------|------|
| `trust_level` 미설정 | 높음 | `isOfficialReference()` false → 공식 인용 불가 |
| `review_status='unreviewed'` (기본값) | 높음 | `strongPrecedentCitation()` false → 판례 공식 인용 불가 |
| `official_citation_allowed` (metadata JSON 안) | 높음 | JSON 파싱 오류 또는 미설정 시 `officialCitationAllowed()` = false |
| `release_stage` (metadata JSON 안) | 중간 | 누락 시 'active'로 간주 — 비교적 안전 |
| `fss_dispute_cases.source_status` | 높음 | `title_seed_needs_full_text`이면 원문 없음 → 공식 근거 제외 |

### 2.3 청킹 단위 분석

| 데이터 유형 | 청킹 단위 | 문제점 |
|-------------|-----------|--------|
| 약관 (`terms_raw_chunks`) | page_no + chunk_no — 페이지/문단 단위 | 적절 |
| 판례 (`court_precedents`) | 판례 1건 = 1 row (full_text_excerpt 별도) | 세부 법리 검색 정밀도 저하 가능 |
| 금감원 분쟁조정례 | title_seed 상태 건은 summary만 있음 | 실제 결정문 내용 없음 |

### 2.4 임베딩 모델 평가

- **모델:** text-embedding-3-small — 범용 모델, 한국어 법률/의료 도메인 특화 미흡
- **동의어 처리 위험:** "I21.4" ↔ "NSTEMI" ↔ "급성 심내막하심근경색증" 시맨틱 매핑이 약할 가능성
- **대안:** text-embedding-3-large (3072d) 또는 한국어 특화 임베딩 모델 검토 필요

---

## 3단계: RAG 검색 실측 결과

> DB 직접 접근 불가 — 코드 분석 기반 예측

### 3.1 5개 쿼리 예측 정확도

| 쿼리 | 예상 정확도 | 이유 |
|------|-------------|------|
| 급성 심내막하심근경색증 I21.4 트로포닌 미상승 NSTEMI 부지급 | 중-상 | heartDiagnosisQuery() 감지, I21.4 코드 보너스, 심장 플레이북 존재 |
| 관상동맥 PCI 시술 후 보험금 분쟁 | 중 | heartDiagnosisQuery() 감지, 코드 없어 정밀도 낮음 |
| 대법원 2013다208661 진단확정 요건 | 낮음-중간 | 특정 판례번호 — DB 커버리지 의존. unreviewed면 internal |
| 허혈성 심장질환 진단 약관 분쟁조정 | 중 | terms_standards 검색 가능, FSS 원문 없으면 한계 |
| 보험금 부지급 의료자문 판례 | 낮음 | 광범위 쿼리, 코드 없음, MIN_SIMILARITY 0.45 노이즈 우려 |

### 3.2 검색 정확도 낮을 경우 원인 가설

1. **FSS·판례 원문 커버리지 부족 (최고 확률)**
   - `fss_dispute_cases`의 title_seed 건들 — 원문 없이 제목만 있음
   - `court_precedents` 대부분 `review_status='unreviewed'` → officialReferences 빈약
   - ragSearch.ts에 title_seed 필터, unreviewed 분기가 촘촘히 있는 것이 증거

2. **text-embedding-3-small 한국어 법률 도메인 시맨틱 한계 (중간 확률)**
   - "I21.4"와 "심내막하심근경색증"이 서로 다른 벡터 공간에 위치 가능
   - "관상동맥조영술"과 "CAG" 시맨틱 유사도 낮을 수 있음

3. **단일 임계값 0.45가 source_area별 최적값과 불일치 (낮은 확률)**
   - 법령은 0.55+, 의료지식은 0.40 정도가 적합할 수 있음
   - 단일값 → 일부 area 노이즈 과다, 다른 area 과소 검색

---

## 4단계: 사정서 샘플 9개 체크리스트

**샘플:** `test-output/i214_assessment_draft_test_a0b01d7b.md` (I21.4 케이스)  
**eval 결과:** `ai_eval/results/assessment_eval_latest.md` — 1건 **FAIL** (FORBIDDEN_PHRASE_FAIL)

### 4.1 v2 보강본 9개 체크리스트

| # | 항목 | 결과 | 상세 |
|---|------|------|------|
| 1 | 보험사 부지급 사유 원문 「」 인용 | ❌ 미충족 | 보험사 입장 언급은 있으나 「」 직접 인용 없음 |
| 2 | 국제 진단기준 명시 (예: Fourth Universal Definition 2018) | ❌ 미충족 | AHA/ESC 기준명·연도 없음 |
| 3 | 진단기준 vs 환자데이터 매핑표 | ❌ 미충족 | 표 형식 없음 |
| 4 | 약관 조항 원문 인용 + 항목별 충족표 | ❌ 미충족 | "가입 당시 약관" 언급만, 원문·충족표 없음 |
| 5 | 보험사 인용 판례 역공 구조 | ❌ 미충족 | 판례 인용·역공 없음 |
| 6 | 의무기록 킬링 에비던스 발굴 | ⚠️ 부분 | hs-troponin T 0.037, PCI 언급 있으나 별도 강조 없음 |
| 7 | 다중 방어선 4개 이상 (의학/약관/판례/약관해석원칙) | ❌ 미충족 | 의학적 판단 + 절차적 주장 2개 수준 |
| 8 | 약한 어미("~사료됩니다") 사용 금지 | ❌ 실패 | "검토 가치가 있습니다", "확정할 수는 없으나" 다수 |
| 9 | 결론·요청사항 3종 (보험금/지연이자/서면회신) | ⚠️ 부분 | 지연이자 요청 없음 |

**총점: 0/9 완전 충족 (2개 부분 충족)**

### 4.2 구형 포맷 vs 신형 포맷 불일치

- 테스트 샘플은 구형 JSON 섹션 방식 (title/overview/facts/issues/...)으로 출력됨
- 현재 코드는 `finalSubmissionAssessmentReport` (submission_report_v2) 포맷 사용
- **현재 샘플이 최신 코드 결과를 반영하지 않아 품질 평가 신뢰도 제한적**
- 재배포 후 신형 포맷 샘플로 재평가 필요

### 4.3 eval FAIL 원인

```
ASSESS_001: FORBIDDEN_PHRASE_FAIL
- forbidden argument wording: /\[일자 확인\]/g
```

- gpt-4o 출력에 `[일자 확인]` 플레이스홀더 포함
- `enforceSubmissionReportContract()`가 `/\[일자\s*확인\]/g` 제거 시도하지만 eval에서 여전히 감지됨
- 가능 원인: `customerSideAssessmentReport` 또는 `adjusterOpinionDraft` 등 다른 필드에 있고 postprocess 미적용

---

## 5단계: 3대 병목 우선순위

| 순위 | 병목 | 위치 | 난이도 | 예상 효과 |
|------|------|------|--------|-----------|
| **1** | FSS·판례 원문 데이터 커버리지 부족 → officialReferences 항상 빈약 | 데이터 파이프라인 | 어려움 | 사정서 공식 근거 섹션 충실화, 설득력 대폭 향상 |
| **2** | `selfVerificationPasses()` I21.4 하드코딩 → 비심장 케이스에 self-repair 항상 유발 | `create-assessment-draft/index.ts:1588` | 중간 | 비심장 케이스 품질 편차 해소 |
| **3** | eval 1건 FAIL + baseline 동기화 불일치 | `scripts/evalAssessmentDrafts.js` | 쉬움 | 회귀 기준선 복구, CI 신뢰성 확보 |

---

## 종합 권장사항

### 즉시 (1-2일)
1. `create-assessment-draft` Edge Function 재배포
2. `npm run ai:assessment:eval -- --limit 1` 재실행 → FORBIDDEN_PHRASE_FAIL 해소 확인
3. 100건 baseline 전체 재실행: `npm run ai:assessment:eval`

### 단기 (1주)
4. `selfVerifySubmissionReport()` + `repairSubmissionReport()`에 profile 파라미터 추가 → 비심장 케이스 repair 조건 분리
5. `enforceSubmissionReportContract()` 적용 범위를 `sanitizeResult()` 내 전체 필드로 확장

### 중기 (2-4주)
6. FSS 분쟁조정례 원문 PDF OCR 파이프라인 완성 (`e2eGoogleDocumentAiRealPdfBatchOcr.js` 활용)
7. 핵심 판례 수동 review → `review_status='reviewed'`, `official_citation_allowed=true` 업데이트
8. MIN_SIMILARITY를 source_area별로 차별화 (법령 0.55, 의료지식 0.42 등)

### 중장기 (1개월+)
9. reasoning engine 교체 (deterministic composer → structured prompt + rubric 기반 재작성 루프)
10. text-embedding-3-large 또는 한국어 특화 임베딩 모델 검토
11. docx/PDF export 구현
