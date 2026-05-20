# 트랙 1.5 적용 변경 사항

작성일: 2026-05-21  
작업자: Claude Code (Sonnet 4.6)  
기준 브랜치: master

---

## 변경 파일

| 파일 | 변경 유형 | 목적 |
|------|---------|------|
| `supabase/functions/_shared/ragSearch.ts` | 3개 라인 수정 | RAG 검색 오버헤드 감소 |

---

## 변경 A: dispute_resolution_cases searchPlan 제거

**파일:** `supabase/functions/_shared/ragSearch.ts:147` (삭제)

**Before:**
```typescript
const searchPlan = [
  { source_area: 'legal_statutes', count: 3 },
  { source_area: 'terms_standards', count: 3 },
  { source_area: 'fss_dispute_cases', count: 3 },
  { source_area: 'dispute_resolution_cases', count: 3 },  // ← 삭제
  { source_area: 'precedents', count: 3 },
  ...
];
```

**After:**
```typescript
const searchPlan = [
  { source_area: 'legal_statutes', count: 3 },
  { source_area: 'terms_standards', count: 3 },
  { source_area: 'fss_dispute_cases', count: 3 },
  { source_area: 'precedents', count: 3 },
  ...
];
```

**근거:** Track 1에서 `dispute_resolution_cases` 1,934건 전체를 `fss_dispute_cases`로 이동. 현재 row 수: 0건. 매 요청마다 1 RPC + 1 enrichRows = 2 Supabase API 호출 낭비.  
`searchPlan` 항목 수: 12 → **11** (-1)

---

## 변경 B: rpcSearch fetch 수 감소

**파일:** `supabase/functions/_shared/ragSearch.ts:1023`

**Before:**
```typescript
const rawRows = await rpcSearch(
  params.supabaseUrl, params.serviceRoleKey,
  embedding, plan.source_area,
  Math.max(plan.count * 4, 10)  // count=3 → 12건, count=2 → 10건
);
```

**After:**
```typescript
const rawRows = await rpcSearch(
  params.supabaseUrl, params.serviceRoleKey,
  embedding, plan.source_area,
  Math.max(plan.count * 2, 6)   // count=3 → 6건, count=2 → 6건
);
```

**근거:**
- 이전: 11 category × 12건 = 132건 fetch + 132건 enrichRows
- 이후: 11 category × 6건 = 66건 fetch + 66건 enrichRows  
- 절감: **50% 데이터 감소**
- 실제 사용 수: official max 8건 + internal max 12건 = 20건 → fetch 66건으로도 충분

---

## 변경 C: RAG 참고자료 요약 길이 축소

**파일:** `supabase/functions/_shared/ragSearch.ts:851`

**Before:**
```typescript
summary: clip(row.summary || row.chunk_text, 700),
```

**After:**
```typescript
summary: clip(row.summary || row.chunk_text, 500),
```

**근거:**
- Track 1 이후 official 8건 + internal 12건 = 20건이 거의 항상 최대치로 채워짐
- 700자 × 20건 = 14,000자 ≈ 4,700 tokens (RAG 섹션)
- 500자 × 20건 = 10,000자 ≈ 3,300 tokens
- 절감: **약 1,400 tokens per 프롬프트** × 2 GPT 호출 = 2,800 tokens 감소
- 대부분의 요약(summary 필드)은 100-400자이므로 실질적 내용 손실 최소

---

## 변경 전후 비교

| 지표 | 변경 전 | 변경 후 | 변화 |
|------|--------|--------|------|
| searchPlan 항목 수 | 12 | 11 | -1 |
| Supabase API 호출 수 (최대) | 24 | 22 | -2 |
| rpcSearch 1회당 fetch | 10-12건 | 6건 | -50% |
| 총 enrichRows 처리 데이터 | ~132건 | ~66건 | -50% |
| RAG 요약 최대 길이 | 700자/건 | 500자/건 | -29% |
| 예상 RAG 섹션 토큰 | ~4,700 | ~3,300 | -30% |

---

## 미변경 항목 및 사유

| 항목 | 값 | 유지 사유 |
|------|-----|---------|
| GPT max_tokens | 6,000 | 품질 기준 (출력 완전성) |
| callOpenAI 호출 횟수 | 2회 순차 | 2차 호출이 1차 출력에 의존 |
| mapWithConcurrency concurrency | 4 | 적절 수준 |
| officialReferences.slice(0, 8) | 8 | 품질 기준 (근거 다양성) |

---

## 배포 안내

변경사항이 적용되려면 Supabase Edge Function 재배포 필요:

```
Supabase Dashboard → Functions → create-assessment-draft → Deploy
```

또는 CLI가 가능한 경우:
```powershell
supabase functions deploy create-assessment-draft --project-ref xnbmostitbwntazexpos
```

재배포 후 즉시 eval 검증:
```powershell
npm.cmd run ai:assessment:eval -- --limit 3
```
