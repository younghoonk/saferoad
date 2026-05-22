# Phase 2-C Transport Error 수정 보고서

작성일: 2026-05-22  
커밋: 이 파일 포함 commit

---

## 수정 내용

### 수정 1: `callOpenAI` — 빈 content 진단 로깅

**파일:** `supabase/functions/create-assessment-draft/index.ts` (line ~1140)

OpenAI가 HTTP 200을 반환했지만 `choices[0].message.content`가 null/빈 문자열인 경우,
Supabase Edge Function 로그에 다음을 기록:

```
OpenAI returned empty content {
  finish_reason: "content_filter" | "length" | "stop" | ...,
  message: { role: "assistant", content: null },
  usage: { prompt_tokens: N, completion_tokens: 0, total_tokens: N },
  prompt_length: N
}
```

**목적:** 근본 원인 규명 —  
- `finish_reason="content_filter"` → OpenAI 콘텐츠 필터 트리거 (D25 자궁근종/실손보험 조합)  
- `finish_reason="length"` → max_tokens 또는 context window 초과  
- `finish_reason="stop"` + 빈 content → 모델 이상

**확인 방법:** 재배포 후 Supabase Dashboard → Functions → create-assessment-draft → Logs

---

### 수정 2: DRAFT 호출 try-catch + emptyRagResult 재시도

**파일:** `supabase/functions/create-assessment-draft/index.ts` (line ~4013)

```typescript
// 수정 전
const draftText = await callOpenAI(apiKey, buildDraftPrompt(input, ragResult), 0.2);
const draft = sanitizeResult(parseJsonResponse(draftText));

// 수정 후
let draft: AssessmentDraftResult;
try {
  const draftText = await callOpenAI(apiKey, buildDraftPrompt(input, ragResult), 0.2);
  draft = sanitizeResult(parseJsonResponse(draftText));
} catch (draftErr) {
  console.warn('draft call failed, retrying with reduced prompt', { ... });
  const draftText = await callOpenAI(apiKey, buildDraftPrompt(input, emptyRagResult()), 0.2);
  draft = sanitizeResult(parseJsonResponse(draftText));
}
```

**효과:**
- TRANSPORT_ERROR (완전 실패) → RAG 없는 draft quality 결과 반환 (graceful degradation)
- 빈 RAG 프롬프트는 훨씬 짧아 GPT-4o content=null 문제 우회 가능
- 재시도도 실패 시 기존과 동일하게 502 반환 (outer catch)

**로그 패턴 (재시도 발생 시):**
```
draft call failed, retrying with reduced prompt {
  error: "AI 응답을 분석할 수 없습니다. 다시 시도해 주세요.",
  profile: "general_disclosure",
  insuranceType: "실손보험",
  accidentType: "고지의무/계약해지"
}
```

---

## 배포 후 검증 절차

1. **Supabase Dashboard 재배포**  
   `create-assessment-draft` → Deploy (또는 CLI):
   ```powershell
   supabase functions deploy create-assessment-draft --project-ref xnbmostitbwntazexpos
   ```

2. **단건 eval로 DRAFT retry 동작 확인**
   ```powershell
   npm.cmd run ai:assessment:eval -- --case ASSESS_007 --retries 1
   npm.cmd run ai:assessment:eval -- --case ASSESS_011 --retries 1
   npm.cmd run ai:assessment:eval -- --case ASSESS_097 --retries 1
   ```

3. **로그 확인** (Supabase Dashboard → Logs):
   - `"OpenAI returned empty content"` 로그 → `finish_reason` 확인
   - `"draft call failed, retrying"` 로그 → retry 동작 확인
   - 재시도 후 HTTP 200 반환 확인

4. **15건 eval**
   ```powershell
   npm.cmd run ai:assessment:eval -- --limit 15 --retries 2 --delay 2000
   ```
   - 목표: TE 3건 → 0~1건

---

## 기대 결과

| 케이스 | 수정 전 | 수정 후 (예상) |
|--------|---------|--------------|
| ASSESS_007 (D25 질병보험) | TRANSPORT_ERROR | PASS (reduced RAG) |
| ASSESS_011 (M54 실손보험) | TRANSPORT_ERROR | PASS (reduced RAG) |
| ASSESS_005 (K29 실손보험) | TRANSPORT_ERROR | PASS (reduced RAG) |
| ASSESS_097 (면책/부지급) | TRANSPORT_ERROR | PASS 또는 FORBIDDEN_PHRASE |

> 주의: reduced RAG draft는 공식 근거(판례/FSS) 없이 생성되므로 사정서 품질이 낮을 수 있음.  
> 이는 TRANSPORT_ERROR(아예 생성 불가)보다 낫지만 이상적이지 않음.  
> 근본 원인이 `finish_reason` 로그로 확인되면 추가 최적화 가능.

---

## 미해결 기술 부채

| 항목 | 내용 | 우선순위 |
|------|------|---------|
| `finish_reason` 원인 확인 | 로그에서 content_filter vs length 구분 후 대응 | 높음 |
| ASSESS_097 FORBIDDEN_PHRASE | 수정 후에도 재발 가능, 단건 eval로 확인 필요 | 중간 |
| max_tokens 최적화 | context window 초과 가능성 → 6000으로 축소 검토 | 중간 |
