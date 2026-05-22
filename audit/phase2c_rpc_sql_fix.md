# Phase 2-C RPC SQL 최적화 + AbortSignal 배포 확인

작성일: 2026-05-22

---

## 1. 적용 SQL 전문 (Dashboard SQL Editor에 그대로 붙여넣기)

```sql
-- medical_issue_codes 전용 ivfflat ANN 경로 추가
-- 기존 분기 1·2·3 동작 완전 보존

create or replace function public.match_rag_master_chunks(
  query_embedding vector,
  match_count integer default 12,
  source_area_filter text default null,
  min_similarity double precision default 0.65,
  source_type_filter text default null,
  dataset_version_filter text default null,
  release_stage_filter text default null,
  include_staging boolean default false
)
returns table(
  id uuid,
  source_area text,
  source_type text,
  title text,
  summary text,
  chunk_text text,
  keywords text,
  source_url text,
  page_no integer,
  trust_level text,
  similarity double precision
)
language plpgsql
stable
as $function$
begin
  -- 분기 1: source_type_filter + dataset_version_filter 모두 있음 (원본 보존)
  if source_type_filter is not null and dataset_version_filter is not null then
    return query
    with filtered as materialized (
      select r.*
      from public.rag_master_chunks r
      where r.embedding is not null
        and r.source_type = source_type_filter
        and r.metadata->>'dataset_version' = dataset_version_filter
        and (source_area_filter is null or r.source_area = source_area_filter)
        and coalesce(r.metadata->>'release_stage', 'active') <> 'deprecated'
        and (
          release_stage_filter is null
          or coalesce(r.metadata->>'release_stage', 'active_implicit') = release_stage_filter
        )
        and (
          include_staging
          or r.metadata->>'release_stage' is null
          or r.metadata->>'release_stage' = 'active'
          or lower(coalesce(r.metadata->>'is_active', '')) = 'true'
        )
    )
    select
      f.id,
      f.source_area,
      f.source_type,
      f.title,
      f.summary,
      f.chunk_text,
      f.keywords,
      f.source_url,
      f.page_no,
      f.trust_level,
      1 - (f.embedding <=> query_embedding) as similarity
    from filtered f
    where 1 - (f.embedding <=> query_embedding) >= min_similarity
    order by f.embedding <=> query_embedding
    limit match_count;
    return;
  end if;

  -- 분기 2: source_type_filter만 있음 (원본 보존)
  if source_type_filter is not null then
    return query
    with filtered as materialized (
      select r.*
      from public.rag_master_chunks r
      where r.embedding is not null
        and r.source_type = source_type_filter
        and (source_area_filter is null or r.source_area = source_area_filter)
        and coalesce(r.metadata->>'release_stage', 'active') <> 'deprecated'
        and (
          release_stage_filter is null
          or coalesce(r.metadata->>'release_stage', 'active_implicit') = release_stage_filter
        )
        and (
          include_staging
          or r.metadata->>'release_stage' is null
          or r.metadata->>'release_stage' = 'active'
          or lower(coalesce(r.metadata->>'is_active', '')) = 'true'
        )
    )
    select
      f.id,
      f.source_area,
      f.source_type,
      f.title,
      f.summary,
      f.chunk_text,
      f.keywords,
      f.source_url,
      f.page_no,
      f.trust_level,
      1 - (f.embedding <=> query_embedding) as similarity
    from filtered f
    where 1 - (f.embedding <=> query_embedding) >= min_similarity
    order by f.embedding <=> query_embedding
    limit match_count;
    return;
  end if;

  -- 신규: medical_issue_codes 전용 ANN 경로
  -- (이 지점에서 source_type_filter IS NULL 보장)
  if source_area_filter = 'medical_issue_codes' then
    execute 'set local ivfflat.probes = 10';
    return query
    select
      r.id,
      r.source_area,
      r.source_type,
      r.title,
      r.summary,
      r.chunk_text,
      r.keywords,
      r.source_url,
      r.page_no,
      r.trust_level,
      1 - (r.embedding <=> query_embedding) as similarity
    from public.rag_master_chunks r
    where r.source_area = 'medical_issue_codes'
      and r.embedding is not null
      and coalesce(r.metadata->>'release_stage', 'active') <> 'deprecated'
      and (
        release_stage_filter is null
        or coalesce(r.metadata->>'release_stage', 'active_implicit') = release_stage_filter
      )
      and (
        include_staging
        or r.metadata->>'release_stage' is null
        or r.metadata->>'release_stage' = 'active'
        or lower(coalesce(r.metadata->>'is_active', '')) = 'true'
      )
    order by r.embedding <=> query_embedding
    limit match_count * 4;
    return;
  end if;

  -- 분기 3: catch-all (원본 보존)
  return query
  with filtered as materialized (
    select r.*
    from public.rag_master_chunks r
    where r.embedding is not null
      and (source_area_filter is null or r.source_area = source_area_filter)
      and coalesce(r.metadata->>'release_stage', 'active') <> 'deprecated'
      and (
        release_stage_filter is null
        or coalesce(r.metadata->>'release_stage', 'active_implicit') = release_stage_filter
      )
      and (
        include_staging
        or r.metadata->>'release_stage' is null
        or r.metadata->>'release_stage' = 'active'
        or lower(coalesce(r.metadata->>'is_active', '')) = 'true'
      )
  )
  select
    f.id,
    f.source_area,
    f.source_type,
    f.title,
    f.summary,
    f.chunk_text,
    f.keywords,
    f.source_url,
    f.page_no,
    f.trust_level,
    1 - (f.embedding <=> query_embedding) as similarity
  from filtered f
  where 1 - (f.embedding <=> query_embedding) >= min_similarity
  order by f.embedding <=> query_embedding
  limit match_count;
end;
$function$;
```

위 SQL 실행 후 통계 갱신:
```sql
analyze public.rag_master_chunks;
```

---

## 2. 설계 결정 사항

### min_similarity 처리 방식: SQL에서 제거, caller에서 후처리

| 방식 | 장점 | 단점 | 결정 |
|------|------|------|------|
| SQL WHERE 1-(emb<=>q) >= min_similarity | DB 필터링 | ANN 근사 특성상 결과 0건 위험 | ❌ |
| SQL LIMIT match_count * 4, min_similarity 미적용 | 항상 결과 반환 | 저유사도 후보도 반환됨 | ✅ 채택 |

**이유:** ivfflat은 ANN(Approximate Nearest Neighbor). `ORDER BY embedding <=> q LIMIT N` 이후에 `WHERE similarity >= threshold`를 추가하면 PostgreSQL이 인덱스를 우회해 전체 스캔을 할 수 있거나, ANN이 찾은 N개 후보 중 threshold 미달이 많을 경우 결과 0건 반환. `match_count * 4 = 24`개 후보를 반환하면 `ragSearch.ts`의 `directlyRelevantInternal()` 함수가 실질적 필터링을 수행.

### ivfflat.probes = 10 설정

| 파라미터 | 기본값 | 설정값 | 의미 |
|---------|--------|--------|------|
| ivfflat.probes | 1 | 10 | lists=100 중 10개(10%) 파티션 탐색 |

probes=1은 너무 빠르지만 가장 가까운 파티션만 탐색 → 재현율 낮음. probes=10으로 10배 향상. medical_issue_codes 16만 건에서 10% = 1.6만 건 탐색 → 수 ms 이내 완료.

---

## 3. 적용 순서

```
1. SQL Editor 실행
   ─ 위 CREATE OR REPLACE FUNCTION SQL 붙여넣기 → 실행
   ─ ANALYZE public.rag_master_chunks; 실행

2. 즉시 동작 확인 (SQL Editor에서)
   SELECT *
   FROM match_rag_master_chunks(
     (SELECT embedding FROM rag_master_chunks WHERE source_area='medical_issue_codes' LIMIT 1),
     6, 'medical_issue_codes', 0.45
   );
   → 결과가 1초 이내 반환되면 ivfflat 인덱스 작동 중

3. Edge Function 재배포 (AbortSignal + RPC_TIMEOUT 로그 포함)
   supabase functions deploy create-assessment-draft --project-ref xnbmostitbwntazexpos

4. 단건 eval
   npm.cmd run ai:assessment:eval -- --case ASSESS_007 --retries 1
```

---

## 4. 배포 성공 확인 기준

### SQL 적용 성공 판단

Supabase Dashboard → SQL Editor에서 실행:
```sql
explain (analyze, buffers)
select count(*)
from match_rag_master_chunks(
  (select embedding from rag_master_chunks where source_area='medical_issue_codes' limit 1),
  6, 'medical_issue_codes', 0.45
);
```

| EXPLAIN 출력 | 판단 |
|-------------|------|
| `Index Scan using rag_master_chunks_medical_issue_codes_emb_idx` | ✅ ivfflat 사용 |
| `Seq Scan on rag_master_chunks` | ❌ 인덱스 미사용 (ANALYZE 재실행 필요) |

### Edge Function 재배포 성공 판단

ASSESS_007 eval 후 Supabase Dashboard → Functions → Logs 검색:

| 로그 패턴 | 의미 |
|---------|------|
| `[ragSearch] RPC_TIMEOUT` or `[ragSearch] RPC_FAIL` | ✅ 새 코드 배포됨 |
| `source_area search FAILED` | ❌ 구 코드 여전히 실행 중 |
| (medical_issue_codes 관련 로그 없음) | ✅ SQL도 적용됨, ANN 정상 작동 |

### 최종 목표 상태

```
medical_issue_codes RPC 로그 없음
  → ivfflat ANN이 수 ms 이내 완료
  → statement_timeout 미발동
  → AbortSignal 미발동
  → ragSearch 정상 완료
  → GPT-4o 시간 예산 확보
  → ASSESS_007 PASS
```

---

## 5. ragSearch.ts isTimeout 보강 (작업 2)

파일: `supabase/functions/_shared/ragSearch.ts`

```typescript
// 수정 전
const isTimeout = fetchErr instanceof DOMException && fetchErr.name === 'TimeoutError';

// 수정 후
// TimeoutError: Deno 1.33+, AbortError: Deno 1.29-1.32 (AbortSignal.timeout이 AbortError로 던지는 버전)
const isTimeout = fetchErr instanceof DOMException
  && (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError');
```

**효과:** AbortSignal.timeout 발동 시, Deno 버전 무관하게 `[ragSearch] RPC_TIMEOUT` 로그 정상 기록.  
기능 동작(빈 결과 반환)은 어느 버전이든 동일하므로 이건 로깅 정확도 개선.

---

## 6. 소스 파일 변경 목록 (이 커밋)

| 파일 | 변경 내용 |
|------|----------|
| `supabase/migrations/20260522120000_optimize_medical_issue_codes_rpc.sql` | 신규 — RPC 함수 완전한 수정본 |
| `supabase/functions/_shared/ragSearch.ts` | isTimeout AbortError 보강 |
| `audit/phase2c_rpc_sql_fix.md` | 이 파일 |
