# 트랙 1.5 진단 보고서

작성일: 2026-05-21  
작업자: Claude Code (Sonnet 4.6)

---

## 1. 증상

- Edge Function `create-assessment-draft` 응답 시간: **50-60초**
- 502 오류율: **약 50%** (Supabase Edge Function 기본 타임아웃 60초 초과로 추정)
- Track 1 이전 응답 시간: ~25-30초 (정상)

---

## 2. 요청 처리 흐름 (순서 기준)

```
1. validateInput()                           — CPU, <1ms
2. getRagResult() → searchRagReferences()    — 24 Supabase API 호출, ~2-5s
3. appendServerDefaultPolicyEvidence()        — CPU
4. appendMedicalGuidelineEvidence()           — CPU
5. callOpenAI(buildDraftPrompt, 0.2)          — GPT-4o 1차 호출, max_tokens=6000
6. parseJsonResponse() + sanitizeResult()     — CPU
7. callOpenAI(buildReviewPrompt, 0)           — GPT-4o 2차 호출, max_tokens=6000
8. finalize*() × 12                           — CPU 후처리
9. buildFinalSubmissionAssessmentReport()     — CPU (selfVerify, repair 포함)
```

**5, 7번 두 GPT 호출은 순차 실행** — 1차 결과가 2차 프롬프트에 사용됨.

---

## 3. 병목 분석

### 3.1 GPT-4o 2회 순차 호출 (주요 원인)

| 호출 | 함수 | max_tokens | 예상 입력 토큰 | 예상 소요 시간 |
|------|------|-----------|--------------|-------------|
| 1차 | buildDraftPrompt | 6,000 | ~12,000-16,000 | 8-15s |
| 2차 | buildReviewPrompt | 6,000 | ~14,000-18,000 | 10-18s |
| **합계** | | | | **18-33s** |

- Track 1 이후 officialReferences 증가 → RAG 프롬프트 섹션 토큰 증가
- official 8개 × 700자 요약 = 5,600자, internal 12개 × 700자 = 8,400자
- RAG 섹션 총 ~14,000자 ≈ 4,700 Korean tokens (3자/token 기준)
- 두 호출 모두 동일 크기 프롬프트 사용 → 누적 지연

### 3.2 Supabase API 24회 호출 (부차 원인)

```
searchPlan(12개 category) × (1 RPC + 1 enrichRows REST) = 24 API 호출
mapWithConcurrency(searchPlan, 4, ...) → 3 파동 × ~8 병렬 = 3 직렬 파동
```

| 파동 | categories | 예상 시간 |
|------|-----------|---------|
| 1 | legal_statutes, terms_standards, fss_dispute_cases, **dispute_resolution_cases** | ~400ms |
| 2 | precedents, medical_guideline, medical_knowledge, medical_issue_codes | ~400ms |
| 3 | issue_playbooks, practice_playbooks, real_case_patterns, real_case_documents | ~400ms |
| 합계 | | ~1.2-3s |

#### dispute_resolution_cases: 불필요한 RPC (낭비)

Track 1에서 1,934건 전체를 `fss_dispute_cases`로 이동.  
`source_area='dispute_resolution_cases'`인 row: **0건**.  
searchPlan에 남아 있어 매 요청마다 1 RPC + 1 enrichRows = 2 API 호출 낭비.

### 3.3 rpcSearch 과다 fetch (낭비)

```typescript
// ragSearch.ts line 1024
Math.max(plan.count * 4, 10)   // count=3 → 12건, count=2 → 10건 fetch
```

- 12개 category × 12건 = **144건** fetch + 144건 enrichRows
- 실제 사용: official 최대 8건 + internal 최대 12건 = **20건**
- 낭비율: 144건 fetch → 20건 사용 = **86% 낭비**

enrollRows는 per-category REST 호출 1회로 해당 category의 모든 fetch 결과를 enrichment하므로,  
fetch 수를 줄이면 REST 응답 페이로드와 처리 시간이 비례하여 감소한다.

### 3.4 RAG 섹션 토큰 비용 (프롬프트 팽창)

`toReference()` 내 `clip(summary || chunk_text, 700)`:  
- 700자 × 20개 = 14,000자 ≈ 4,700 tokens (RAG 섹션만)
- Track 1 이전: 대부분 results empty → 실제로는 2,000-4,000자
- Track 1 이후: 7,249개 eligible row → 거의 항상 8/12 최대치

---

## 4. Track 1과의 인과관계

| 항목 | Track 1 전 | Track 1 후 | 영향 |
|------|-----------|-----------|------|
| officialReferences 히트율 | 낮음 (대부분 staging 필터) | 높음 (7,249건 active) | RAG 프롬프트 토큰 +40-60% |
| dispute_resolution_cases rows | 1,934건 | 0건 | 무의미한 RPC 1회 잔존 |
| embedding done | 169,876 | 170,823 | 미미한 영향 |

---

## 5. 적용할 최적화 (Track 1.5 변경 목표)

| # | 파일 | 변경 | 절감 효과 |
|---|------|------|---------|
| A | ragSearch.ts:147 | `dispute_resolution_cases` searchPlan 제거 | RPC 1회 + enrichRows 1회 감소 |
| B | ragSearch.ts:1024 | `plan.count * 4` → `plan.count * 2`, `10` → `6` | fetch/enrich 데이터 ~50% 감소 |
| C | ragSearch.ts:852 | `clip(summary\|\|chunk_text, 700)` → `clip(..., 500)` | RAG 프롬프트 토큰 ~28% 감소 |

**예상 효과:**
- API 호출: 24 → 22 (-2)
- 총 fetch 데이터: 144건 → ~66건 (-54%)
- RAG 프롬프트 토큰: ~4,700 → ~3,400 tokens (-28%)
- 예상 응답 시간 단축: 5-10초

**미변경 항목:**
- GPT max_tokens=6000 (2회 호출 구조): 품질 기준이므로 유지
- officialReferences.slice(0, 8): 품질 기준이므로 유지
- mapWithConcurrency concurrency=4: 현재 적절 수준

---

## 6. 코드 위치 (변경 대상)

| 파일 | 줄 | 현재 코드 | 변경 후 |
|------|-----|---------|--------|
| ragSearch.ts | 147 | `{ source_area: 'dispute_resolution_cases', count: 3 },` | 라인 삭제 |
| ragSearch.ts | 1024 | `Math.max(plan.count * 4, 10)` | `Math.max(plan.count * 2, 6)` |
| ragSearch.ts | 852 | `clip(summary \|\| row.chunk_text, 700)` | `clip(summary \|\| row.chunk_text, 500)` |
