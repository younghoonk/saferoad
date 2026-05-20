# SafeRoad TODO

최종 업데이트: 2026-05-21  
기준 문서: `HANDOFF.md`, `audit/01_diagnosis.md`

---

## 즉시 (오늘)

- [ ] **`create-assessment-draft` Edge Function 재배포**
  ```powershell
  supabase functions deploy create-assessment-draft --project-ref xnbmostitbwntazexpos
  ```

- [ ] **eval 재실행 → FORBIDDEN_PHRASE_FAIL 해소 확인**
  ```powershell
  npm.cmd run ai:assessment:eval -- --limit 1
  ```
  - 목표: `[일자 확인]` 플레이스홀더 누출 없음

- [ ] **100건 baseline 전체 재실행**
  ```powershell
  npm.cmd run ai:assessment:eval
  ```
  - 목표: Pass 100 / Fail 0

---

## 1주차 — 버그픽스 & 엔진 품질 개선

### BUG-001: selfVerification cardiac hardcode (우선순위: 높음)
- **파일:** `supabase/functions/create-assessment-draft/index.ts:1588`
- **문제:** `selfVerifySubmissionReport()`가 I21.4/NSTEMI regex로만 성공 판단 → 비심장 케이스에서 `medicalStandardNamed`, `killingEvidencePresent` 항상 false → repair 항상 실행
- **수정 방향:**
  - `selfVerifySubmissionReport(report, argument, preAnalysis, profile)` — profile 파라미터 추가
  - 심장 케이스에만 심근경색 기준 regex 적용
  - 다른 프로파일에는 프로파일별 verification 기준 추가
- [ ] 수정 구현
- [ ] 비심장 케이스 (ASSESS_017 고지의무, ASSESS_031 실손) eval 통과 확인

### BUG-002: FORBIDDEN_PHRASE 적용 범위 불완전 (우선순위: 높음)
- **파일:** `supabase/functions/create-assessment-draft/index.ts:1448`
- **문제:** `enforceSubmissionReportContract()`가 `finalSubmissionAssessmentReport`에만 적용됨. `adjusterOpinionDraft` 등 다른 필드에서 `[일자 확인]` 등 금지표현 누출
- **수정 방향:**
  - `sanitizeResult()` 내에서 모든 text 필드에 `enforceSubmissionReportContract()` 적용
  - 또는 forbidden phrase 제거를 `sanitizeResult()` 내에서 별도 pass로 처리
- [ ] 수정 구현
- [ ] ASSESS_001 eval 통과 확인

### BUG-003: evalAssessmentDrafts.js mojibake (우선순위: 중간)
- **파일:** `scripts/evalAssessmentDrafts.js`
- **문제:** 일부 한글 문자열이 mojibake 상태
- [ ] 해당 문자열 목록 확인 및 수정

### BUG-004: assessmentDraftApi.ts mojibake (우선순위: 중간)
- **파일:** `src/lib/assessmentDraftApi.ts`
- **문제:** source label 한글 mojibake 가능성
- [ ] 확인 및 수정

---

## 2주차 — 사정서 엔진 교체 준비

### ENGINE-001: v2 hard assertion 실패 지점 전수 분석
- [ ] 100건 eval 결과에서 실패 케이스 패턴 분류
- [ ] 각 실패 유형별 원인 분석 (prompting 문제 vs 데이터 문제 vs 코드 문제)

### ENGINE-002: reasoning engine 강화
- **현재:** 2-pass OpenAI 호출 + deterministic composer
- **목표:** structured prompt + rubric 기반 재작성 루프
- [ ] 새 엔진 설계 문서 작성
- [ ] gpt-4o max_tokens 6000 → 8000-10000 검토 (복잡 케이스 truncation 방지)
- [ ] 프로파일별 verification rubric 설계

### ENGINE-003: piiRedacted 검증 로직 수정
- **파일:** `supabase/functions/create-assessment-draft/index.ts:1599`
- **문제:** `[피보험자]` 마스킹 문자열이 없으면 항상 false → repair 유발
- [ ] 비심장/비I21.4 케이스에서 piiRedacted 조건 완화 또는 conditional 처리

---

## 3-4주차 — RAG 데이터 품질 개선

### DATA-001: FSS 분쟁조정례 원문 확보 (우선순위: 높음)
- **현황:** 다수의 `fss_dispute_cases`가 `title_seed_needs_full_text` 상태 (원문 없음)
- [ ] `e2eGoogleDocumentAiRealPdfBatchOcr.js`로 FSS PDF OCR 파이프라인 완성
- [ ] 원문 확보된 건 `source_status='official_fss_full_text'` 업데이트
- [ ] `npm run rag:fss:fetch && npm run rag:fss:import` 주기적 실행

### DATA-002: 판례 review 및 citation 승인 (우선순위: 높음)
- **현황:** 대부분 `review_status='unreviewed'` → 공식 인용 불가
- [ ] 핵심 판례 목록 확정 (I21.4, 고지의무, 암보험 관련)
- [ ] 수동 review → `review_status='reviewed'`, `official_citation_allowed=true` 업데이트
- [ ] `npm run rag:precedent:fetch && npm run rag:precedent:import`

### DATA-003: MIN_SIMILARITY source_area별 차별화 (우선순위: 중간)
- **현황:** 단일 0.45 적용 (법령과 의료지식에 동일 임계값)
- [ ] 법령(legal_statutes): 0.55 검토
- [ ] 의료지식(medical_knowledge): 0.40 유지
- [ ] 판례(precedents): 0.50 검토
- [ ] A/B 테스트 및 eval 비교

### DATA-004: 임베딩 모델 업그레이드 검토 (우선순위: 낮음)
- **현황:** text-embedding-3-small (1536d)
- [ ] text-embedding-3-large (3072d) 비용·성능 비교
- [ ] 한국어 특화 임베딩 모델 조사

---

## 미결 기능 (낮은 우선순위)

- [ ] docx/PDF export 구현 (사정서 파일 다운로드)
- [ ] 채팅 첨부 Storage 정식 구현
- [ ] DB trigger/RPC 회원가입 원자성 개선
- [ ] CORS 제한 적용

---

## 참고: eval smoke test 케이스

엔진 수정 시 아래 8개 케이스는 항상 통과해야 한다 (`ASSESSMENT_BASELINE.md` 기준).

```powershell
npm.cmd run ai:assessment:eval -- --case ASSESS_001   # 계약전 알릴의무 (M47.26)
npm.cmd run ai:assessment:eval -- --case ASSESS_017   # (케이스 확인 필요)
npm.cmd run ai:assessment:eval -- --case ASSESS_031   # (케이스 확인 필요)
npm.cmd run ai:assessment:eval -- --case ASSESS_051   # (케이스 확인 필요)
npm.cmd run ai:assessment:eval -- --case ASSESS_063   # (케이스 확인 필요)
npm.cmd run ai:assessment:eval -- --case ASSESS_075   # (케이스 확인 필요)
npm.cmd run ai:assessment:eval -- --case ASSESS_087   # (케이스 확인 필요)
npm.cmd run ai:assessment:eval -- --case ASSESS_095   # (케이스 확인 필요)
```
