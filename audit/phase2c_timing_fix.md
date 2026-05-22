# Phase 2-C 타이밍 문제 해결 조치

적용일: 2026-05-22  
대상 파일: `supabase/functions/create-assessment-draft/index.ts`  
근거 분석: `audit/phase2c_failure_analysis.md`

---

## 1. 타이밍 문제 확정 근거

| 근거 | 내용 |
|---|---|
| ASSESS_066 단독 PASS | baseline FAIL → 단독 실행 즉시 PASS (1회 시도) |
| ASSESS_076 단독 PASS | baseline FAIL → 단독 실행 즉시 PASS (1회 시도) |
| 입력 크기 차이 없음 | FAIL avg 124자 vs PASS avg 140자 — FAIL이 오히려 작음 |
| 모든 FAIL이 attempts=3 | 3회 재시도 전부 동일 에러 → 세션 내 지속적 부하 |
| 에러 메시지 단일 | "Edge Function returned a non-2xx status code" — 콘텐츠 무관 |

**결론: 콘텐츠/프로파일 원인 아님. 101건 연속 실행 세션에서 OpenAI 부하 구간이 발생하고, Draft+Review 두 호출 합산 시간이 Edge Function 60s 타임아웃을 초과한 것.**

---

## 2. 적용한 3개 조치

### 조치 1 — `buildReviewPrompt`에서 `formatRagForPrompt` 블록 제거

**변경 위치**: [index.ts:1085-1086](../supabase/functions/create-assessment-draft/index.ts) (제거)

```diff
- [RAG search references]
- ${formatRagForPrompt(ragResult)}
-
  [Official grounds that must remain in the body]
```

**효과**: Review 프롬프트에서 전체 RAG chunk 텍스트(~12,000자, ~3,000 토큰) 제거.  
프롬프트 총 길이 약 30% 축소 → GPT-4o 처리 시간 단축.

**품질 영향 없는 이유**:
- `[제공된 참고자료]` (`formatReferences`) 블록이 이미 있어 핵심 참고자료가 Review에 제공됨
- `[Official grounds that must remain in the body]` (`formatOfficialGroundsForBody`) 블록이 공식 근거를 직접 제공
- Review는 Draft를 **다듬는** 단계 — Draft에서 이미 RAG 전체를 소화한 결과물이 `[초안 JSON]`으로 전달됨
- `[RAG review rules]`의 "RAG search references" 언급은 `[제공된 참고자료]`와 `[Official grounds]`를 참조하는 것으로 충분

### 조치 2 — Review 단계 `max_tokens` 8000 → 5000

**변경 위치**: `callOpenAI` 시그니처 + Review 호출부

```diff
- async function callOpenAI(apiKey, prompt, temperature, maxRetries = 3)
+ async function callOpenAI(apiKey, prompt, temperature, maxRetries = 3, maxTokens = 8000)

  // Review 호출:
- await callOpenAI(apiKey, buildReviewPrompt(...), 0)
+ await callOpenAI(apiKey, buildReviewPrompt(...), 0, 3, 5000)
```

**효과**: Review 출력 상한 축소 → GPT-4o 최대 생성 토큰 38% 감소 → 응답 시간 비례 단축.  
Draft `max_tokens`는 8000 유지 (초안 생성 단계는 충분한 출력 필요).

**품질 영향 없는 이유**:  
Review는 Draft 초안 JSON을 **수정**하는 단계. 수정 없이 필드를 통과시킬 경우 출력이 작아지고, 수정 시에도 개별 필드 편집이므로 5000 토큰이면 충분. Draft 생성(8000 토큰 필요)과 성격이 다름.

### 조치 3 — `finish_reason` 항상 로깅

**변경 위치**: `callOpenAI` 내 성공 응답 처리부

```typescript
console.info('OpenAI response', {
  finish_reason: choice?.finish_reason,
  prompt_tokens: json.usage?.prompt_tokens,
  completion_tokens: json.usage?.completion_tokens,
  prompt_length: prompt.length,
  maxTokens,
});
```

**효과**: 향후 `finish_reason: length` (토큰 잘림) 발생 시 Supabase Dashboard 로그에서 즉시 확인 가능.  
`prompt_tokens`로 실제 프롬프트 크기도 측정 가능 → 추가 최적화 데이터 확보.

---

## 3. 변경 요약

| 항목 | 이전 | 이후 |
|---|---|---|
| Review 프롬프트 RAG 블록 | 포함 (~3,000 토큰) | 제거 |
| Review `max_tokens` | 8,000 | 5,000 |
| Draft `max_tokens` | 8,000 | 8,000 (유지) |
| finish_reason 로그 | 빈 응답 시만 | 항상 |
| 타입 체크 | — | `npx tsc --noEmit` 오류 없음 |

---

## 4. 재측정 절차 및 기대치

### 재배포 후 실행
```powershell
# 재배포
supabase functions deploy create-assessment-draft --project-ref xnbmostitbwntazexpos

# smoke test 1건 먼저
npm.cmd run ai:assessment:eval -- --case ASSESS_101

# 101건 baseline 재측정
npm.cmd run ai:assessment:eval -- --retries 2
```

### 판단 기준

| 결과 | 해석 |
|---|---|
| FAIL 25 → 10 이하 | 타임아웃 개선 확인. 남은 FAIL은 세션 부하 재측정 필요 |
| FAIL 25 → 0~5 | 조치 효과 충분. 콘텐츠 문제 없음 확인 |
| FAIL이 다른 케이스 세트 | 타이밍 확정 (콘텐츠 무관 증거) |
| FAIL 케이스 세트 동일 | 콘텐츠/프로파일 원인 가능 — 추가 분석 필요 |

### 추가 확인 항목 (Supabase 로그)
- `finish_reason` 분포: `stop` vs `length` 비율
- `prompt_tokens` 평균: Draft vs Review 비교
- `completion_tokens` 평균: 조치 전후 비교

---

## 5. 미적용 보류 조치

| 조치 | 보류 이유 |
|---|---|
| GPT-4o-mini 전환 (Review) | 사정서 품질 영향 우려 — 현재 조치로 충분한지 먼저 확인 |
| config.toml timeout 연장 | 조치 1·2로 60s 내 완료 가능한지 먼저 확인 |
| 파이프라인 분리 (Draft/Review 별도 함수) | 구현 복잡도 높음 — 현재 조치 효과 측정 후 결정 |

---

*생성: 2026-05-22, Phase 2-C 타이밍 수정 조치 기록*
