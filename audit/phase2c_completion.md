# Phase 2-C 완료 보고서

작성일: 2026-05-22  
커밋: 이 파일 포함 commit (phase2c medical guideline DB import)

---

## 요약

Phase 2-C는 ASSESS_097 FORBIDDEN_PHRASE 수정, Transport Error 18건 fallback 처리, 의료 가이드라인 27건 DB 강화를 완료했다.

---

## 작업별 완료 현황

### 작업 1: ASSESS_097 FORBIDDEN_PHRASE 수정 ✅
- **commit:** `3f78ddc` (2026-05-22)
- **파일:** `supabase/functions/create-assessment-draft/index.ts`
- **변경 내용:**
  - `enforceSubmissionReportContract()`: `재검토 필요성 → 이의 근거` 등 사전 치환 4개 추가
  - `prohibitedPatterns`: `/재검토\s*(?:가|를|은|는)?\s*필요(?:합니다|하다)?/g` 추가
  - `weakLanguageAbsent`: 동일 패턴 broadening
- **원인:** 기존 패턴이 `재검토 필요성`(명사형) 슬립스루
- **상세:** `audit/phase2c_task1_assess097.md`

### 작업 2: Transport Error 18건 fallback 처리 ✅
- **commit:** `3f78ddc` (2026-05-22)
- **파일:** `supabase/functions/create-assessment-draft/index.ts`
- **변경 내용:**
  - review GPT-4o 호출 try-catch + draft quality fallback
  - `applyReviewPipeline()` 헬퍼 추출
- **원인:** 2× GPT-4o 호출 × max_tokens=8000 → ~60-80s > 60s timeout
- **효과:** TRANSPORT_ERROR 완전 실패 → draft quality 결과 반환 (graceful degradation)
- **상세:** `audit/phase2c_task2_transport.md`
- **⚠️ 주의:** 이 변경은 아직 Supabase Dashboard에 재배포 필요

### 작업 3+4: 의료 가이드라인 18건 수집·가공 ✅
- **저장 위치:** `data_sources/medical_guidelines_phase2c/`
- **분야별:**
  - 암(cancer): 8건 (상피내암, 경계성종양, GIST, 흑색종, NET, TNM병기, 난소암, 병리진단)
  - 뇌(brain): 7건 (허혈성뇌졸중, ICH, SAH, TIA, NIHSS, mRS, 혈관성치매)
  - 심장(heart): 3건 (심부전, NSTEMI ESC2020, 심방세동)
- **형식:** 가이드라인명·발행기관·적용질환 헤더 + 진단기준·약관연결·사정서활용·키워드 4섹션
- **출처:** WHO, ESC, AHA, AJCC, FIGO 국제 학회 가이드라인
- **출처 접근 기록:** `audit/phase2c_source_blocked.md`

### 작업 5: DB 적재 + 임베딩 ✅
- **스크립트:** `scripts/importMedicalGuidelinesPhase2C.js --execute`
- **실행 결과:**
  - 18건 INSERT 성공 (errors: 0)
  - 임베딩 생성 완료 (embedding_status='done', model='text-embedding-3-small')
  - `rag_master_chunks` medical_guideline 총 27건 (기존 9건 + 신규 18건)
- **메타데이터:**
  - `source_area`: `medical_guideline`
  - `review_status`: `reviewed`
  - `metadata.official_citation_allowed`: `true`
  - `metadata.dataset_version`: `phase2c_medical_guidelines_2026-05-22`
  - `metadata.reprocessing_source`: `phase2c`

### 작업 6: 효과 검증 eval ⏳ 배포 대기
- **전제 조건:** `create-assessment-draft` Edge Function 재배포 필요
- **커밋 준비 완료:** `3f78ddc` (local, push 미완료)
- **재배포 후 실행 명령:**
  ```powershell
  npm run ai:assessment:eval -- --case ASSESS_097
  npm run ai:assessment:eval -- --limit 15 --retries 2 --delay 2000
  ```
- **기대 결과:**
  - ASSESS_097: FORBIDDEN_PHRASE_FAIL → PASS
  - TE 케이스: TRANSPORT_ERROR → draft quality result (일부 PASS 예상)
  - 암/뇌/심장 카테고리: RAG 강화 효과 (의학 가이드라인 인용 증가)

---

## 남은 액션 (사용자 필요)

1. **Edge Function 재배포** (Supabase Dashboard → create-assessment-draft → Deploy)
   - 또는: `supabase functions deploy create-assessment-draft --project-ref xnbmostitbwntazexpos`
2. **작업6 eval 실행:**
   ```powershell
   npm run ai:assessment:eval -- --case ASSESS_097
   npm run ai:assessment:eval -- --limit 15 --retries 2 --delay 2000
   ```
3. **git push** (commit `3f78ddc` + 이번 commit)

---

## DB 상태 스냅샷 (2026-05-22)

| source_area | 총 건수 | 신규(phase2c) |
|---|---|---|
| medical_guideline | 27 | 18 |
| (기존 9건 유지) | - | - |

---

## 기술 부채 (미해결)

| 항목 | 파일 | 우선순위 |
|---|---|---|
| selfVerification cardiac hardcode | `create-assessment-draft/index.ts:1588` | 높음 |
| gpt-4o max_tokens 6000 truncation | `create-assessment-draft/index.ts:1114` | 중간 |
| evalAssessmentDrafts.js mojibake | `scripts/evalAssessmentDrafts.js` | 중간 |
| docx/PDF export 미구현 | — | 낮음 |
