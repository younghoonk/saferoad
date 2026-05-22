# Phase 2-C Transport Error 진단 보고서

작성일: 2026-05-22  
진단 범위: ASSESS_005, ASSESS_007, ASSESS_011, ASSESS_097 TRANSPORT_ERROR

---

## 1. 진단 요약

| 항목 | 내용 |
|------|------|
| 에러 코드 | HTTP 502 |
| 에러 메시지 | `"AI 응답을 분석할 수 없습니다. 다시 시도해 주세요."` |
| 발생 위치 | `parseJsonResponse()` — line 1164 |
| 근본 원인 | OpenAI가 HTTP 200을 반환하지만 JSON 없는 빈 content (`choices[0].message.content = null 또는 ""`) |
| 응답 시간 | **10-12초 (일관적 고속 실패)** — 60초 타임아웃 아님 |
| fallback 효과 | Phase 2-C fallback은 REVIEW 호출만 보호 → DRAFT 실패는 무방비 |

---

## 2. 오류 발생 경로

```
callOpenAI(draft) → HTTP 200 반환 (OK)
  → json.choices[0].message.content = null or ""
  → parseJsonResponse("") → match = null
  → throw HttpError(502, "AI 응답을 분析할 수 없습니다.")
    ↓
outer catch (line 4103) → return jsonResponse({error: "..."}, 502)
    ↓
eval script: supabase.functions.invoke → error "Edge Function returned a non-2xx status code"
    ↓
AssessmentTransportError → TRANSPORT_ERROR
```

Phase 2-C Task 2 fallback (lines 4063-4067)은 **REVIEW 호출 실패만** 잡음:
```typescript
try {
  reviewedText = await callOpenAI(review prompt);       // ← fallback 있음
} catch {
  reviewedBase = applyReviewPipeline(draft);             // ← fallback 동작
}
// DRAFT 호출 (line 4013)은 try-catch 밖 → 실패 시 outer catch에 도달
```

---

## 3. 실패 패턴 (직접 테스트 결과)

### 3-1. 실패/성공 조합 테스트

| 케이스 | insuranceType | accidentType | diagnosisText | 결과 | 응답시간 |
|--------|--------------|--------------|---------------|------|---------|
| ASSESS_004 | 질병보험 | 고지의무/계약해지 | E78 고지혈증 | **PASS** | 33s |
| ASSESS_007 | 질병보험 | 고지의무/계약해지 | D25 자궁근종 | **FAIL** | 12s |
| D25_MIN | 질병보험 | 고지의무/계약해지 | D25 (최소) | **FAIL** | 11s |
| E78_MIN | 질병보험 | 고지의무/계약해지 | E78 (최소) | **PASS** | 32s |
| D25 + 실손보험 부지급 | 질병보험 | 실손보험 부지급 | D25 자궁근종 | **PASS** | 39s |
| ASSESS_005 | 실손보험 | 고지의무/계약해지 | K29 위염 | **FAIL** | 11s |
| K29 + 질병보험 | 질병보험 | 고지의무/계약해지 | K29 위염 | **PASS** | 37s |
| E78 + 실손보험 | 실손보험 | 고지의무/계약해지 | E78 고지혈증 | **FAIL** | 11s |

### 3-2. 실패 패턴 규칙

**실패 조건 1:** `고지의무/계약해지` + `실손보험` → 진단코드 무관 FAIL  
**실패 조건 2:** `고지의무/계약해지` + D25 계열 (benign tumor D-code) → insuranceType 무관 FAIL

> 두 조건 모두 `general_disclosure` 프로파일을 사용하지만 FAIL. E78(질병보험) 동일 프로파일은 PASS.

### 3-3. 확인된 비원인

- **의료 가이드라인(Phase 2-C Task 3-5):** D25 쿼리 최고 similarity = 0.32 (MIN_SIMILARITY 0.45 미만) → RAG 미반영
- **타임아웃 원인:** 11-12초 실패 = 60초 타임아웃 아님, 다른 원인
- **Phase 2-C 코드 변경(3f78ddc):** DRAFT 호출 경로 무변경. enforceSubmissionReportContract는 후처리에만 영향

---

## 4. 근본 원인 가설 (미확정)

### 가설 H1: OpenAI gpt-4o 모델 버전 변경 (가장 유력)
- "gpt-4o" 별칭은 OpenAI가 silent update함
- Phase 2-B' eval (5/21) → Phase 2-C eval (5/22) 사이 모델 동작 변화 가능
- D25 + 고지의무 / 실손보험 + 고지의무 조합이 새 모델에서 content=null 반환

### 가설 H2: RAG 결합 → 프롬프트 구조 문제
- D25 자궁근종 쿼리가 암 관련 FSS 케이스를 pull (유사도 0.47)
- 고지의무 context + 암 관련 RAG = GPT-4o가 모순된 프롬프트로 인식
- 하지만 최소 페이로드(RAG 최소화)에서도 FAIL → RAG 단독 원인은 약함

### 가설 H3: 실손보험 + 고지의무 조합 특수성
- 실손보험 보험 유형 + 고지의무 쟁점 조합에서 특정 RAG 청크 패턴이 형성
- E78 + 실손 FAIL = 진단코드 무관, 실손+고지의무 조합 자체가 문제

---

## 5. fallback이 효과 없는 이유 재확인

Phase 2-C Task 2에서 구현된 fallback 구조:
```
┌──────────────────────────────────────────────────────┐
│  DRAFT 호출 (line 4013) — try-catch 없음             │ ← 실패하면 502 전파
│  ...                                                  │
│  try { REVIEW 호출 }                                  │ ← fallback 있음
│  catch { applyReviewPipeline(draft) }                 │
└──────────────────────────────────────────────────────┘
```

실제 실패하는 곳: **DRAFT 호출** (11-12초, parseJsonResponse throws).  
→ try-catch가 없어 outer catch(line 4103)로 직행 → HTTP 502 반환.

---

## 6. 신규 회귀 분석

| 케이스 | Phase 2-B' | Phase 2-C | 판정 |
|--------|-----------|-----------|------|
| ASSESS_005 (K29 실손보험) | **TE** (기존 실패) | TE | 지속 실패 |
| ASSESS_007 (D25 질병보험) | **PASS** | TE | **신규 회귀** |
| ASSESS_011 (M54 실손보험) | **PASS** | TE | **신규 회귀** |
| ASSESS_097 (면책/부지급) | FORBIDDEN_PHRASE_FAIL | TE | **회귀 (수정 시도 후 악화)** |

---

## 7. 권고 수정 방향

### 수정 A: DRAFT 호출 try-catch 추가 (필수)

현재 REVIEW 호출만 보호. DRAFT 호출도 동일하게 감싸되, fallback은 **max_tokens 절감 재시도** (빈 RAG 또는 축약 프롬프트).

```typescript
// 현재 (위험)
const draftText = await callOpenAI(apiKey, buildDraftPrompt(input, ragResult), 0.2);
const draft = sanitizeResult(parseJsonResponse(draftText));

// 수정안
let draft: AssessmentDraftResult;
try {
  const draftText = await callOpenAI(apiKey, buildDraftPrompt(input, ragResult), 0.2);
  draft = sanitizeResult(parseJsonResponse(draftText));
} catch {
  // 빈 RAG로 최소 프롬프트 재시도
  console.warn('draft call failed, retrying with reduced prompt');
  const draftText = await callOpenAI(apiKey, buildDraftPrompt(input, emptyRagResult()), 0.2);
  draft = sanitizeResult(parseJsonResponse(draftText));
}
```

효과: TRANSPORT_ERROR → draft-with-reduced-RAG (가용 사정서 반환 가능성)

### 수정 B: max_tokens 조정 (선택)

gpt-4o context window 128k. 실손보험 + 고지의무 케이스의 프롬프트가 context limit 근접 가능성.

- 현재: `max_tokens: 8000` (line 1135)
- 제안: 일부 프로파일에서 `max_tokens: 5000` 시도

### 수정 C: 실손보험 + 고지의무 RAG 필터 조정 (보완)

`sanitizeRagResultForAssessment`에서 실손보험 + 고지의무 조합의 경우 내부 검토자료 제한.

---

## 8. 우선순위 권고

1. **즉시 (수정 A)**: DRAFT 호출 try-catch 감싸기 — emptyRagResult() 재시도
2. **검증**: 수정 후 재배포 → `npm run ai:assessment:eval -- --case ASSESS_007 --case ASSESS_011`
3. **모니터링**: TE 건수 15건 eval 기준 3건 → 0~1건 목표

---

## 9. 테스트 명령어 (수정 후)

```powershell
# 타입 체크
npx.cmd tsc --noEmit

# 재배포
supabase functions deploy create-assessment-draft --project-ref xnbmostitbwntazexpos

# 검증 eval
npm.cmd run ai:assessment:eval -- --case ASSESS_007
npm.cmd run ai:assessment:eval -- --case ASSESS_011
npm.cmd run ai:assessment:eval -- --limit 15 --retries 2 --delay 2000
```

---

*진단 완료. 수정 승인 후 코드 변경 진행 예정.*
