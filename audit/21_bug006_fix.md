# BUG-006 mapWithConcurrency silent failure 수정

작성일: 2026-05-21  
누적 비용: ~$1.5

---

## 1. 문제

`ragSearch.ts`의 `mapWithConcurrency`가 `Promise.all` 사용 → 어느 한 slot이 try-catch 외부에서 throw 시 전체 검색 실패. 특히 배포 환경에서 `precedents` RPC가 silent empty(0건 반환)를 보여도 로그가 없어 원인 파악 불가.

## 2. 수정 내용

**파일:** `supabase/functions/_shared/ragSearch.ts`

### 2.1 mapWithConcurrency → Promise.allSettled

```typescript
// Before: Promise.all — one slot throw = all fail
await Promise.all(Array.from({ length: workerCount }, async () => {
  while (...) {
    results[index] = await worker(...);  // unguarded throw propagates
  }
}));

// After: Promise.allSettled + per-item try-catch
const settled = await Promise.allSettled(Array.from({ length: workerCount }, async () => {
  while (...) {
    try {
      results[index] = await worker(...);
    } catch (err) {
      console.error('[mapWithConcurrency] worker threw at index', index, ...);
    }
  }
}));
for (const s of settled) {
  if (s.status === 'rejected') console.error('[mapWithConcurrency] slot rejected', ...);
}
```

### 2.2 Silent empty 로깅

```typescript
if (sorted.length === 0 && (plan.source_area === 'precedents' || plan.source_area === 'terms_standards')) {
  console.error('[ragSearch] SILENT_EMPTY source_area returned 0 rows', { source_area, query });
}
```

### 2.3 catch 업그레이드 warn → error

```typescript
// Before
console.warn('[ragSearch] source_area search failed', ...);

// After  
console.error('[ragSearch] source_area search FAILED', ...);
```

### 2.4 undefined 방어

```typescript
for (const entry of planResults) {
  if (!entry) continue; // guard for allSettled slot undefined
  const { plan, sorted } = entry;
```

## 3. 효과

- 배포 환경에서 precedents/terms_standards 0건 발생 시 Supabase Function Logs에 `SILENT_EMPTY` 키워드로 가시화
- 한 RPC 카테고리 실패가 전체 검색을 중단시키지 않음
- 5개 카테고리 대표 케이스 (ASSESS_051/031/075/092/066) 모두 PASS — regression 없음

## 4. 미해결

- 근본 원인(왜 precedents RPC가 0건 반환하는지)은 Supabase Function Logs를 실제 배포 후 확인해야 함
- ACUTE_MI는 hardcoded fallback으로 보완 중 (commit 92d25e6)
- 다른 진단 프로파일의 precedents 0건 케이스는 이번 로깅으로 추적 시작
