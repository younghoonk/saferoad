-- medical_issue_codes 전용 ivfflat ANN 경로 추가
--
-- 문제: 기존 함수의 catch-all 분기(분기 3)는 MATERIALIZED CTE를 사용.
--       MATERIALIZED 울타리로 인해 partial ivfflat 인덱스
--       (rag_master_chunks_medical_issue_codes_emb_idx) 사용 불가.
--       → 16만 건 풀스캔 + 코사인 거리 전체 계산 → statement_timeout → HTTP 500.
--
-- 해결: source_area_filter = 'medical_issue_codes' 이고 source_type_filter 없을 때
--       (분기 1,2를 이미 통과한 상태) 전용 경로 실행:
--       - WHERE source_area = 'medical_issue_codes'  (리터럴 — partial index 조건 일치)
--       - ORDER BY r.embedding <=> query_embedding   (base table 직접 — ivfflat 작동)
--       - LIMIT match_count * 4, min_similarity 미적용
--         (ANN은 근사이므로 min_similarity WHERE가 결과를 0건으로 만들 위험.
--          대신 후보를 넓게 뽑아 caller(ragSearch.ts)의 directlyRelevantInternal 에서 걸러냄)
--       - ivfflat.probes = 10 (default 1 → 10으로 상향, lists=100 기준 10% 탐색, 재현율 향상)
--
-- 분기 1, 2, 3: 원본 코드 완전 보존. 동작 변경 없음.

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
  -- ----------------------------------------------------------------
  -- 분기 1: source_type_filter + dataset_version_filter 모두 있음
  -- (원본 코드 — 변경 없음)
  -- ----------------------------------------------------------------
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

  -- ----------------------------------------------------------------
  -- 분기 2: source_type_filter만 있음
  -- (원본 코드 — 변경 없음)
  -- ----------------------------------------------------------------
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

  -- ----------------------------------------------------------------
  -- 신규: medical_issue_codes 전용 ANN 경로
  -- 이 지점에서 source_type_filter IS NULL 이 보장됨 (분기 1,2 통과)
  -- ----------------------------------------------------------------
  if source_area_filter = 'medical_issue_codes' then
    -- ivfflat.probes: default=1(너무 빠르지만 재현율 낮음) → 10으로 상향
    -- lists=100 기준, probes=10 → 10% 파티션 탐색 → 재현율/속도 균형
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
    where r.source_area = 'medical_issue_codes'       -- 리터럴: partial index 조건 정확 일치
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
      -- min_similarity 미적용: ANN은 근사이므로 threshold WHERE가 결과를 0건으로 만들 수 있음.
      -- match_count * 4 후보를 반환하면 caller(ragSearch.ts)가 directlyRelevantInternal 로 필터링.
    order by r.embedding <=> query_embedding           -- base table 직접: ivfflat 인덱스 작동
    limit match_count * 4;
    return;
  end if;

  -- ----------------------------------------------------------------
  -- 분기 3: catch-all (source_type_filter 없고 medical_issue_codes 아닌 경우)
  -- (원본 코드 — 변경 없음)
  -- ----------------------------------------------------------------
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

-- 적용 후 즉시 실행 권장 (인덱스 통계 갱신)
-- analyze public.rag_master_chunks;
