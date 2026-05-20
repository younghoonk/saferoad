# SafeRoad / 보상파트너 — Claude Code 영구 컨텍스트

이 파일은 모든 Claude Code 세션이 시작 시 자동 참조하는 프로젝트 컨텍스트다.  
마지막 업데이트: 2026-05-21

---

## 프로젝트 개요

**보상파트너(SafeRoad)**는 보험사 부지급/감액 결정에 대한 손해사정서를 AI로 자동 생성하는 도구다.

- **사용자:** 보험금 분쟁 중인 피보험자 또는 손해사정사
- **핵심 가치:** v2 보강본 수준의 법률·의학 논거가 담긴 제출 가능한 사정서 자동 생성
- **핵심 방향:** `보험사 주장 → 무력화 → 지급 의무 확정`
- **스택:** React Native/Expo (앱) + Supabase Edge Functions (백엔드) + OpenAI (GPT-4o + text-embedding-3-small) + PostgreSQL pgvector (RAG)

---

## 3대 목표

1. **v2 보강본 수준의 사정서 품질 달성**
   - `방태복_손해사정서_v2_보강본-1.docx`를 gold answer로 삼는다
   - 급성심근경색 케이스: I21.4, NSTEMI, CAG/PCI, troponin, EKG, SOAP 기록 중심 killing evidence 논리
   - 목표 출력: 보험사 제출용 손해사정서 (일반 안내문 아님)

2. **서버 저장 데이터 가공 품질 점검 및 개선**
   - `redacted-only` 정책 유지 (extracted_text DB 영구 저장 금지)
   - RAG Evidence Pack이 실제 사정서 본문에 정확히 반영되는지 평가

3. **전체 시스템 안정화**
   - Edge Function, 앱 UI, eval 스크립트, 테스트 루틴을 배포 전 검증 가능하게 유지
   - RAG에 고객 의료자료가 섞이지 않도록 유지

---

## v2 보강본 9개 품질 체크리스트

사정서 생성 또는 프롬프트 수정 후 반드시 아래 9개 항목을 확인한다.

- [ ] 보험사 부지급 사유 원문을 「」 안에 직접 인용
- [ ] 국제 진단기준 명시 (예: Fourth Universal Definition of Myocardial Infarction 2018)
- [ ] 진단기준 vs 환자데이터 매핑표 (표 형식)
- [ ] 약관 조항 원문 인용 + 항목별 충족표
- [ ] 보험사가 인용한 판례를 역공 — 같은 법리를 고객 측 유리하게 재적용
- [ ] 의무기록에서 killing evidence 1개 이상 별도 강조 (SOAP note, troponin 수치, PCI 전후 검사 등)
- [ ] 다중 방어선 4개 이상 — Ⅲ의학 / Ⅳ약관 / Ⅴ판례 / Ⅵ약관해석원칙
- [ ] 약한 어미 사용 금지 ("~사료됩니다", "~가능성이 있습니다", "검토 가치가 있습니다")
- [ ] 결론·요청사항 3종 — ① 보험금 지급 ② 지연이자 ③ 구체적 서면 회신

---

## 사정서 7단 구조 (강제)

```
Ⅰ. 사건 경위 — 의무기록 중심 객관 사실, 보험사의 편집된 사실 프레임 금지
Ⅱ. 부지급 반박 — 보험사 부지급 문구 직접 인용 → 결정적 오류 3-5개 분류
Ⅲ. 의학 — 국제 진단기준 → 환자 데이터 매핑표 → 결론
Ⅳ. 약관 — 약관 문구 인용 → 요건별 환자 자료 매칭표 → 결론
Ⅴ. 판례·금감원 — 보험사 인용 판례 역공 또는 유리한 판례 적용
Ⅵ. 약관해석 원칙 — 보험사가 약관에 없는 요건 추가 불가, 불명확 조항 피보험자 유리 해석
Ⅶ. 결론·요청사항 — 첫째/둘째/셋째 + 보험금/지연이자/서면회신 3종 요청
```

---

## 절대 금지 사항 (보안·컴플라이언스)

1. **`extracted_text` 저장 재도입 금지** — redacted-only 정책 유지
2. **고객 의료자료를 `rag_master_chunks`에 저장 금지** — RAG leak 방지
3. **fixture, log, prompt example에 실제 PII 저장 금지** — 비식별화 처리 후 사용
4. **OCR/Batch/redacted-only 로직은 사정서 품질 작업 중 건드리지 말 것** — 현재 안정화됨
5. **`evalAssessmentDrafts.js`는 원격 Edge Function 호출** — 로컬 수정 후 재배포 전 eval 실행 금지 (이전 배포본으로 평가됨)

---

## 핵심 파일 인덱스

### 사정서 생성 (entry point)
- `supabase/functions/create-assessment-draft/index.ts`
  - `buildDraftPrompt()` — 메인 프롬프트 (line 856~)
  - `buildFinalSubmissionAssessmentReport()` — v2 최종 보고서 합성 (line 1420)
  - `selfVerifySubmissionReport()` — self-verification (line 1574) ⚠️ I21.4 하드코딩 버그
  - `repairSubmissionReport()` — self-repair (line 1622)
  - `enforceSubmissionReportContract()` — 금지표현 제거 (line 1448)

### RAG 파이프라인
- `supabase/functions/_shared/ragSearch.ts`
  - `EMBEDDING_MODEL = 'text-embedding-3-small'`
  - `MIN_SIMILARITY = 0.45`
  - `searchPlan` — 12개 source_area 검색 플랜 (line 143)
  - `searchRagReferences()` — 메인 검색 함수 (line 1006)

- `supabase/functions/_shared/medicalGuidelineEvidence.ts`
  - `appendMedicalGuidelineEvidence()` — acute MI 의학 가이드라인 보강

- `supabase/functions/_shared/detectAssessmentProfile.ts`
  - `detectAssessmentProfile()` — 케이스 프로파일 자동 감지

### 평가 및 gold answer
- `ai_eval/gold_answers/acute_mi_submission_report_gold_redacted.json` — v2 gold fixture
- `ai_eval/assessment_cases_100_v1.json` — 100건 평가 케이스
- `ai_eval/ASSESSMENT_BASELINE.md` — baseline 기준
- `ai_eval/results/assessment_eval_latest.json` — 최신 eval 결과

### 데이터 파이프라인 스크립트
- `scripts/evalAssessmentDrafts.js` — 사정서 eval (`npm run ai:assessment:eval`)
- `scripts/testRagSearch.js` — RAG 검색 테스트 (`npm run rag:search:test`)
- `scripts/checkRagData.js` — RAG 데이터 상태 점검 (`npm run rag:check`)
- `scripts/checkRagEmbeddings.js` — 임베딩 상태 점검 (`npm run rag:embeddings:check`)
- `scripts/auditRagReleaseState.js` — RAG 릴리즈 상태 감사
- `scripts/importFssLatestCases.js` — FSS 최신 사례 가져오기 (`npm run rag:fss:import`)
- `scripts/importKoicdPrecedents.js` — 판례 가져오기
- `scripts/embedRagDatasetChunks.js` — 임베딩 배치 실행

### 앱 소스
- `src/lib/assessmentDraftApi.ts` — 사정서 API 클라이언트
- `src/lib/ragReferences.ts` — RAG 참고자료 타입
- `src/screens/shared/AIAnalysisScreen.tsx` — AI 탭 화면

### Supabase 스키마 (주요)
- `supabase/migrations/20260504_create_rag_tables.sql` — rag_master_chunks 스키마
- `supabase/migrations/20260512121500_update_match_rag_master_chunks_filters.sql` — 필터링 RPC

### audit 결과물
- `audit/01_diagnosis.md` — 1단계 진단 보고서 (본 파일 작성 기준)
- `audit_report.md` — 품질 점검 상세 보고서

---

## 환경 변수 (이름만 — 값 절대 기재 금지)

```
# 앱 공개 env
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY

# Edge Function / Supabase
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

# OpenAI
OPENAI_API_KEY

# OCR / Google Document AI
OCR_PROVIDER
GOOGLE_DOCUMENT_AI_SERVICE_ACCOUNT_JSON
GOOGLE_DOCUMENT_AI_LOCATION
GOOGLE_DOCUMENT_AI_PROCESSOR_ID
GOOGLE_OCR_GCS_BUCKET
GOOGLE_OCR_GCS_INPUT_PREFIX
GOOGLE_OCR_GCS_OUTPUT_PREFIX

# eval/test
TEST_ADJUSTER_EMAIL
TEST_ADJUSTER_PASSWORD

# RAG 스크립트
SUPABASE_URL           (in .env.rag.local)
SUPABASE_SERVICE_ROLE_KEY (in .env.rag.local)
OPENAI_API_KEY         (in .env.rag.local)
```

---

## 작업 원칙

1. **모든 변경은 브랜치에서 진행** — main/master 직접 푸시 금지
2. **`create-assessment-draft` 수정 후 반드시 Edge Function 재배포 필요**
   ```powershell
   # 재배포 (Supabase CLI)
   supabase functions deploy create-assessment-draft --project-ref xnbmostitbwntazexpos
   ```
3. **재배포 후 즉시 회귀 테스트 실행**
   ```powershell
   npm run ai:assessment:eval -- --limit 1
   ```
4. **회귀 기준:** v2 보강본 acute MI gold fixture 통과 (`ASSESS_001` ~ `ASSESS_008` smoke test)
5. **타입 체크 먼저:**
   ```powershell
   npx.cmd tsc --noEmit
   ```

---

## 자주 쓰는 명령어

```powershell
# 타입 체크
npx.cmd tsc --noEmit

# 배포 + eval 한 번에 (권장)
.\scripts\deploy_and_eval.ps1              # 배포 → 10s 대기 → eval --limit 1
.\scripts\deploy_and_eval.ps1 -limit 5     # eval 5건
.\scripts\deploy_and_eval.ps1 -case ASSESS_001  # 특정 케이스

# 사정서 eval (원격 Edge Function 호출 — 재배포 후 실행)
npm.cmd run ai:assessment:eval -- --limit 1
npm.cmd run ai:assessment:eval              # 전체 100건

# 특정 케이스만
npm.cmd run ai:assessment:eval -- --case ASSESS_001
npm.cmd run ai:assessment:eval -- --case ASSESS_017

# RAG 검색 테스트
npm.cmd run rag:search:test -- "I21.4 트로포닌 NSTEMI 부지급"

# RAG 데이터 점검
npm.cmd run rag:check
npm.cmd run rag:embeddings:check
node scripts/auditRagReleaseState.js

# FSS/판례 데이터 가져오기
npm.cmd run rag:fss:fetch && npm.cmd run rag:fss:import
npm.cmd run rag:precedent:fetch && npm.cmd run rag:precedent:import

# OCR 관련 (건드리지 말 것 — 안정화됨)
node scripts/testOcrPostProcessingJobs.js
node scripts/testGoogleDocumentAiBatchOcr.js
```

---

## 현재 작업 상태

**브랜치:** `rag-datasets-staging`

**즉시 해야 할 것:**
1. `create-assessment-draft` Edge Function 재배포
2. `npm run ai:assessment:eval -- --limit 1` → FORBIDDEN_PHRASE_FAIL 해소 확인
3. 100건 baseline 재검증

**알려진 버그:**
- `selfVerifySubmissionReport()` I21.4 regex 하드코딩 → 비심장 케이스 항상 repair 유발 (`index.ts:1588`)
- `[일자 확인]` 플레이스홀더가 일부 출력 필드에서 postprocess 미적용 상태로 누출

**미해결 이슈:** `HANDOFF.md` 3.2 섹션 참조

---

## 현재 알려진 기술 부채

| 항목 | 파일 | 우선순위 |
|------|------|----------|
| selfVerification cardiac hardcode | `create-assessment-draft/index.ts:1588` | 높음 |
| FORBIDDEN_PHRASE eval 1건 FAIL | `scripts/evalAssessmentDrafts.js` | 높음 |
| FSS/판례 원문 데이터 부족 | 데이터 파이프라인 | 높음 |
| evalAssessmentDrafts.js mojibake | `scripts/evalAssessmentDrafts.js` | 중간 |
| assessmentDraftApi.ts mojibake | `src/lib/assessmentDraftApi.ts` | 중간 |
| gpt-4o max_tokens 6000 truncation | `create-assessment-draft/index.ts:1114` | 중간 |
| docx/PDF export 미구현 | — | 낮음 |
