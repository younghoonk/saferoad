# SafeRoad / 보상파트너 작업 인수인계

작성일: 2026-05-21  
작업 위치: `C:\Users\PCA\saferoad`

## 1. 프로젝트 목표 3가지

1. **v2 보강본 수준의 사정서 퀄리티 달성**
   - 첨부 기준 문서 `방태복_손해사정서_v2_보강본-1.docx`를 gold answer로 삼아, AI 결과를 일반 안내문이 아니라 보험회사 제출용 손해사정서로 생성한다.
   - 핵심 방향은 `보험사 주장 → 무력화 → 지급 의무 확정`이다.
   - 급성심근경색 진단비 분쟁에서는 I21.4, NSTEMI/Unstable angina, CAD, CAG/PCI, troponin, EKG, 주치의 SOAP 기록 등 killing evidence 중심 논리를 강제한다.

2. **서버 저장 데이터 가공 품질 점검 및 개선**
   - OCR 원문은 DB에 영구 저장하지 않는 `redacted-only` 정책을 유지한다.
   - `redacted_text`, `case_medical_facts`, `medical_timeline_events`, `report_timeline_rows`, RAG Evidence Pack의 품질을 점검한다.
   - FSS/판례/약관/의학 기준 evidence가 실제 사정서 본문에 정확히 반영되는지 평가한다.

3. **전체 시스템 안정화**
   - AI 탭 파일 업로드, 대용량 PDF Batch OCR, redaction, facts/timeline/report pipeline을 안정적으로 유지한다.
   - RAG 저장 구조에 고객 의료자료가 섞이지 않도록 한다.
   - Edge Function, 앱 UI, eval 스크립트, 테스트 루틴을 배포 전 검증 가능하게 유지한다.

## 2. 현재까지 완료한 작업

### 2.1 1단계 진단 결과 요약

참고 대상: `audit/01_diagnosis.md`

현재 워크스페이스에는 `audit/01_diagnosis.md` 파일이 존재하지 않는다. 따라서 아래 내용은 사용자가 제공한 진단 결과와 현재 코드 점검 결과를 기준으로 정리한다.

- AI 사정서 출력은 제출용 문서 형식으로 이동했지만, v2 보강본 수준의 논리 품질에는 아직 도달하지 못했다.
- 핵심 쟁점은 OCR/BATCH 문제가 아니라 최종 사정서 생성 엔진의 reasoning 구조, Evidence Pack 선택, eval baseline 동기화 문제다.
- 현재 결과 품질 평가상 `사정서 9개 체크리스트 현재 점수: 0/9`로 간주한다.
- 기존 엔진은 좋은 문장을 일부 만들 수 있으나, 실제 제출 문서 수준의 `사전분석 → 논증구조 → 자체검증` 강제가 부족했다.

### 2.2 식별된 3대 병목

1. **FSS/판례 원문 부재**
   - `create-assessment-draft`는 Evidence Pack을 활용하지만, 직접 관련 FSS/판례 원문이 부족하거나 부정확하면 본문이 일반론으로 흐른다.
   - 관련 없는 판례가 붙는 경우가 있었고, 이후 acute MI 필터를 강화했다.
   - 아직 공식 원문 품질과 citation 신뢰도 정비가 필요하다.

2. **selfVerificationPasses 하드코딩**
   - `create-assessment-draft`에 `SelfVerification` 구조를 추가했으나, 현재는 deterministic regex 중심이다.
   - 필수 구조 누락을 잡는 데는 유효하지만, 실제 논증 품질을 판단하기에는 아직 얕다.
   - 다음 단계에서 rubric 기반 평가와 재작성 루프를 강화해야 한다.

3. **eval baseline 미동기화**
   - `scripts/evalAssessmentDrafts.js --limit 1`은 원격 배포된 `create-assessment-draft`를 호출한다.
   - 로컬 코드가 수정되어도 Edge Function 재배포 전에는 기존 배포본 결과로 평가되어 실패할 수 있다.
   - 실제로 `[일자 확인]` 같은 기존 내부 라벨이 원격 결과에서 반환되어 실패한 적이 있다.

### 2.3 완료된 주요 작업 요약

- AI 탭 단순화 및 파일 기반 업로드 UI 구현
  - 면책공문 분석: 보험사 면책공문/안내문, 약관, 진단서/소견서, 환자 의료자료
  - 보고서 작성: 병원자료/의학자료
  - 각 항목 최대 5개 파일 선택, 삭제, 중복 방지

- Android DocumentPicker 업로드 안정화
  - `expo-file-system uploadAsync` 사용
  - Supabase signed upload URL normalize 처리
  - `file://`, `content://` 계열 URI 처리 개선

- 의료자료 OCR pipeline 안정화
  - 작은 PDF/이미지는 online OCR
  - 대용량 PDF는 Google Document AI Batch OCR 경로
  - `large_pdf_async_ocr_required` 상태를 Batch OCR 시작 흐름으로 연결

- redacted-only OCR 저장 정책 적용
  - 신규 OCR row는 `extracted_text: null`
  - `redacted_text`만 저장
  - `metadata.redacted_only = true`
  - `metadata.original_text_stored = false`
  - `pii_findings`는 원문값/원문 offset 없이 축약
  - 기존 `case_document_texts.extracted_text` 원문 row 11건 정리 완료

- RAG leak 방지
  - 고객 의료자료를 `rag_master_chunks`에 저장하지 않는 정책 유지
  - 실제 OCR E2E에서 marker count 0 확인

- 대용량 PDF Batch OCR
  - `start-large-document-ocr`
  - `poll-large-document-ocr`
  - GCS input/output staging 사용
  - OCR raw JSON 전체 DB 저장 금지
  - Batch OCR synthetic 및 실제 PDF 서버 E2E 성공 이력 있음

- 안정화 작업
  - UUID regex 수정
  - 회원가입 profile 누락 앱 복구 플로우 보강
  - 채팅 첨부 local URI 저장 차단
  - `analyze-document` adjuster role check 및 prompt injection 방어
  - H-5 N+1 개선
  - H-7 RAG 검색 concurrency 제한 병렬화
  - H-8 Realtime 사용자 필터 개선

- 사정서 엔진 v2 보강
  - `ClaimArgumentStructure`
  - `KillingEvidence`
  - `PreAnalysisResult`
  - `SelfVerification`
  - `reportFormatVersion = submission_report_v2_claim_argument_structure`
  - `finalSubmissionAssessmentReport` 우선 표시
  - v2 gold fixture 비식별 구조 파일 추가

## 3. 진행 중이거나 다음에 할 작업

### 3.1 다음 단계

**즉시 버그픽스 → 1주차 엔진 교체**

1. `create-assessment-draft` 최신 로컬 변경분을 Edge Function에 재배포한다.
2. `scripts/evalAssessmentDrafts.js --limit 1`을 원격 배포본 기준으로 다시 실행한다.
3. v2 hard assertion 실패 지점을 확인한다.
4. deterministic 보정이 아니라 실제 reasoning engine 교체 작업으로 넘어간다.

### 3.2 미해결 이슈 목록

- `audit/01_diagnosis.md` 파일이 현재 repo에 없음.
- `evalAssessmentDrafts.js` 일부 기존 한글 문자열이 mojibake 상태로 남아 있음.
- `src/lib/assessmentDraftApi.ts` 일부 source label 한글도 mojibake가 남아 있을 수 있음.
- v2 gold fixture는 구조/rubric 중심이며, 원문 전문을 저장하지 않기 때문에 similarity 기반 평가는 제한적이다.
- FSS/판례 원문 품질 부족으로 직접 관련 근거자료가 부족하게 표시될 수 있음.
- `SelfVerification`은 현재 regex/deterministic check 중심이라 품질 판단이 충분하지 않다.
- `create-assessment-draft`가 여전히 OpenAI 2-pass 호출 후 deterministic composer를 붙이는 구조라, 근본적인 엔진 교체 전까지 품질 편차가 남을 수 있다.
- docx/PDF export 기능은 아직 구현하지 않았다.
- 채팅 첨부 Storage 정식 구현, CORS 제한 적용, DB trigger/RPC 회원가입 원자성 개선은 설계/초안 단계로 남아 있다.

## 4. 주요 파일 경로 인덱스

### 4.1 사정서 생성 entry point

- `supabase/functions/create-assessment-draft/index.ts`
  - Edge Function entry point
  - `Deno.serve(...)`
  - `buildDraftPrompt(...)`
  - `buildReviewPrompt(...)`
  - `buildFinalSubmissionAssessmentReport(...)`
  - `composeSubmissionAssessmentReport(...)`

### 4.2 시스템 프롬프트 위치

- `supabase/functions/create-assessment-draft/index.ts`
  - `buildDraftPrompt(...)`
  - `buildReviewPrompt(...)`
  - customer-side loss-adjusting report direction
  - 9개 사전분석 지시
  - 자체검증 지시

### 4.3 사정서 reasoning 구조

- `supabase/functions/create-assessment-draft/index.ts`
  - `ClaimArgumentStructure`
  - `PreAnalysisResult`
  - `KillingEvidence`
  - `SelfVerification`
  - `buildClaimArgumentStructure(...)`
  - `buildPreAnalysisResult(...)`
  - `extractKillingEvidence(...)`
  - `selfVerifySubmissionReport(...)`
  - `repairSubmissionReport(...)`

- `src/lib/claimReasoningMap.ts`
  - AI 탭 sourceAnalysis/reasoning map 구성용 클라이언트 helper

### 4.4 RAG 파이프라인 코드

- `supabase/functions/_shared/ragSearch.ts`
  - embedding model
  - source area별 검색 계획
  - `MIN_SIMILARITY = 0.45`
  - concurrency 제한 병렬화 적용 위치

- `supabase/functions/_shared/medicalGuidelineEvidence.ts`
  - acute MI medical guideline evidence
  - `appendMedicalGuidelineEvidence(...)`
  - `isAcuteMiDenialContext(...)`

- RAG 관련 data/source 후보
  - `data_sources/`
  - `policy_terms_dataset/`
  - `fss_dispute_cases_processed_v1/`
  - `rag_practice_playbooks/`

### 4.5 Supabase 클라이언트

- `src/lib/supabase.ts`
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`

### 4.6 의료자료/OCR pipeline

- `src/lib/medicalReadingApi.ts`
- `src/screens/shared/AIAnalysisScreen.tsx`
- `src/screens/shared/MedicalReadingScreen.tsx`
- `supabase/functions/create-case-document-upload/index.ts`
- `supabase/functions/finalize-case-document-upload/index.ts`
- `supabase/functions/extract-case-document-text/index.ts`
- `supabase/functions/redact-case-document-text/index.ts`
- `supabase/functions/start-large-document-ocr/index.ts`
- `supabase/functions/poll-large-document-ocr/index.ts`

### 4.7 eval 스크립트

- `scripts/evalAssessmentDrafts.js`
- `scripts/evalMedicalReading.js`
- `scripts/e2eMedicalReadingDryRun.js`
- `scripts/testGoogleDocumentAiBatchOcr.js`
- `scripts/testDocumentTextExtractionOcrFallback.js`
- `scripts/testOcrPostProcessingJobs.js`

### 4.8 audit 결과물 위치

- 요청 기준 위치: `audit/01_diagnosis.md`
- 현재 상태: 파일 없음.
- 대체 참고:
  - `ai_eval/results/assessment_eval_latest.json`
  - `ai_eval/results/assessment_eval_latest.md`
  - `ai_eval/gold_answers/acute_mi_submission_report_gold_redacted.json`

## 5. 환경 정보

### 5.1 사용 중인 모델

- Chat completion: `gpt-4o`
  - 위치: `supabase/functions/create-assessment-draft/index.ts`
  - 상수: `OPENAI_MODEL`

- Embedding: `text-embedding-3-small`
  - 위치: `supabase/functions/_shared/ragSearch.ts`
  - 상수: `EMBEDDING_MODEL`

### 5.2 RAG 임계값

- `MIN_SIMILARITY = 0.45`
  - 위치: `supabase/functions/_shared/ragSearch.ts`

### 5.3 주요 환경변수 이름

값은 절대 문서에 기록하지 않는다.

- 앱 공개 env
  - `EXPO_PUBLIC_SUPABASE_URL=***`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY=***`

- Edge Function / Supabase
  - `SUPABASE_URL=***`
  - `SUPABASE_ANON_KEY=***`
  - `SUPABASE_SERVICE_ROLE_KEY=***`

- OpenAI
  - `OPENAI_API_KEY=***`

- OCR / Google Document AI
  - `OCR_PROVIDER=***`
  - `GOOGLE_DOCUMENT_AI_SERVICE_ACCOUNT_JSON=***`
  - `GOOGLE_DOCUMENT_AI_LOCATION=***`
  - `GOOGLE_DOCUMENT_AI_PROCESSOR_ID=***`
  - `GOOGLE_OCR_GCS_BUCKET=***`
  - `GOOGLE_OCR_GCS_INPUT_PREFIX=***`
  - `GOOGLE_OCR_GCS_OUTPUT_PREFIX=***`

- eval/test
  - `TEST_ADJUSTER_EMAIL=***`
  - `TEST_ADJUSTER_PASSWORD=***`

## 6. 코드 컨벤션

### 6.1 언어

- 앱: TypeScript / React Native / Expo
- Edge Functions: TypeScript / Deno
- 스크립트: Node.js JavaScript
- 일부 데이터 처리 및 fixture: JSON / Markdown

### 6.2 테스트/검증 명령

주요 검증 루틴:

```powershell
npx.cmd tsc --noEmit
node scripts/evalMedicalReading.js
node scripts/e2eMedicalReadingDryRun.js
node scripts/evalAssessmentDrafts.js --limit 1
git diff --check
```

OCR 관련 추가 검증:

```powershell
node scripts/testOcrPostProcessingJobs.js
node scripts/testGoogleDocumentAiBatchOcr.js
node scripts/testDocumentTextExtractionOcrFallback.js
```

### 6.3 커밋 메시지 스타일

현재 repo에 강제된 스타일 파일은 확인되지 않았다. 권장 형식:

- `feat(ai): add claim argument pre-analysis`
- `fix(ocr): enforce redacted-only storage`
- `test(eval): add acute MI submission report assertions`
- `docs: add saferoad handoff`

### 6.4 브랜치 전략

현재 명시된 브랜치 전략 파일은 확인되지 않았다. 권장 전략:

- `main`: 배포 기준
- `stabilization/*`: 보안/성능/운영 안정화
- `ai-assessment-v2/*`: 사정서 엔진 품질 개선
- `ocr-batch/*`: 대용량 OCR 및 Batch pipeline

## 7. 외부 의존성

### 7.1 GPT API

- OpenAI Chat Completions API
  - 모델: `gpt-4o`
  - 사용처: `create-assessment-draft`

- OpenAI Embeddings API
  - 모델: `text-embedding-3-small`
  - 사용처: RAG query embedding

### 7.2 Supabase 프로젝트

- Project ref: `xnbmostitbwntazexpos`
- 주요 기능:
  - Auth
  - Postgres
  - Storage
  - Edge Functions
  - Realtime

주요 Edge Functions:

- `create-assessment-draft`
- `create-closing-report`
- `analyze-document`
- `create-case-document-upload`
- `finalize-case-document-upload`
- `extract-case-document-text`
- `redact-case-document-text`
- `extract-medical-facts`
- `extract-medical-timeline-events`
- `build-report-timeline`
- `start-large-document-ocr`
- `poll-large-document-ocr`

### 7.3 기타 연동 서비스

- Google Document AI
  - online OCR
  - batchProcess OCR

- Google Cloud Storage
  - 대용량 PDF Batch OCR input/output staging
  - public access 금지

- Expo / EAS
  - Expo Go 테스트
  - preview APK build

## 8. 다음 담당자에게 전달할 핵심 주의사항

1. OCR/Batch/redacted-only 로직은 현재 안정화되어 있으므로, 사정서 품질 작업 중 건드리지 않는다.
2. 고객 의료자료는 RAG에 저장하지 않는다.
3. `extracted_text` 저장을 재도입하지 않는다.
4. 실제 개인정보를 fixture, log, RAG, prompt example에 저장하지 않는다.
5. `evalAssessmentDrafts.js --limit 1`은 원격 Edge Function을 호출하므로, 로컬 수정 후에는 `create-assessment-draft` 재배포 전 실패할 수 있다.
6. 현재 가장 중요한 다음 작업은 `create-assessment-draft`를 배포한 뒤 v2 hard assertion 결과를 기준으로 사정서 엔진을 1주차 교체하는 것이다.

