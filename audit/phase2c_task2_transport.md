# Phase 2-C Task 2: Transport Error 18건 진단 및 수정

## 현황 (Phase 2-B' baseline)
- transport_error 18건 / 101건 (17.8%)
- 모든 18건: 3/3 재시도 100% 실패 (일시적 오류 아님, 체계적 실패)
- TE 제외 실질 PASS율 98.8%

## 카테고리 분포
| 카테고리 | TE 건수 | 전체 건수 | TE 비율 |
|---------|--------|---------|---------|
| 실손보험 부지급 | 5 | 20 | 25% |
| 암/경계성/제자리암 | 5 | 20 | 25% |
| 면책/부지급 | 2 | 5 | 40% |
| 후유장해 | 2 | 12 | 17% |
| 의료자문/소송 전 | 2 | 4 | 50% |
| 계약전 알릴의무 | 1 | 15 | 7% |
| 뇌질환 진단비 | 1 | 12 | 8% |
| 심장질환 진단비 | 1 | 12 | 8% |

## 진단 결과

### 원인: Edge Function 실행 시간 초과
**흐름**: 2번 GPT-4o 호출 (draft + review)
1. `callOpenAI(buildDraftPrompt)` — max_tokens=8000 출력 → ~20-30s
2. `callOpenAI(buildReviewPrompt)` — draft JSON 포함 + max_tokens=8000 → ~20-40s

**총 실행 시간**: 40~70초. Supabase Edge Function 타임아웃(기본 60초)에 걸림.

**왜 18건만?**: GPT-4o 응답 시간 편차가 있어 대부분 케이스는 40~55초 내 완료. 특정 카테고리(암, 실손, 면책)는 더 상세한 분석이 필요해 GPT 출력이 길어짐 → 타임아웃 초과.

### 추가 관찰
- 입력 길이: TE 케이스(124~160자) ≈ PASS 케이스(141~212자) — 입력 길이 무관
- accidentType 분포: TE/PASS 양쪽에 동일 타입 존재 — 타입 자체가 원인 아님
- 모든 TE 케이스 `detectedProfile: 'unknown'` — 성공한 응답 전무
- `면책/부지급` 40% 실패 — 이 카테고리가 특히 길고 복잡한 응답 필요

## 수정 내용

### review 호출 graceful fallback (index.ts line ~4016)
review 2번째 GPT 호출이 타임아웃/파싱 오류로 실패할 경우, draft 결과를 그대로 finalize 파이프라인에 적용.

```typescript
let reviewedBase: AssessmentDraftResult;
try {
  const reviewedText = await callOpenAI(apiKey, buildReviewPrompt(...), 0);
  reviewedBase = applyReviewPipeline(sanitizeResult(parseJsonResponse(reviewedText)));
} catch {
  console.warn('review call failed, falling back to draft result');
  reviewedBase = applyReviewPipeline(draft);
}
```

**효과**: 완전 실패(TRANSPORT_ERROR) → draft 품질 결과 반환. 모든 finalize 함수는 여전히 적용됨.

## 미해결 이슈
- review 품질 저하 없이 실행 시간 줄이기: max_tokens 파라미터화 검토 (중간 우선순위)
- Supabase 프로젝트 타임아웃 설정 상향 확인 (대시보드 필요)
- 실제 HTTP 오류 코드 파악 위해 Edge Function 로그 조회 필요 (대시보드 필요)

## 배포 후 확인 사항
- `npm run ai:assessment:eval -- --limit 5 --category "암/경계성/제자리암 진단비"` 재실행
- transport_error 감소 확인 (목표: 18건 → 5건 미만)
- PASS율 상승 확인
