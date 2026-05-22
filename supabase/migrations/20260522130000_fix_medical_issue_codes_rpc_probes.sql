-- medical_issue_codes RPC 400 수정
--
-- 원인: 이전 migration(20260522120000)의 `execute 'set local ivfflat.probes = 10'`가
--       PostgreSQL에서 42704(unrecognized configuration parameter) 오류를 발생시킴.
--       PostgREST는 오류 클래스 42xxx → HTTP 400으로 매핑.
--       이 줄은 source_area='medical_issue_codes' 분기에만 있으므로 해당 호출만 400.
--
-- 해결: execute 'set local ivfflat.probes = 10' 제거.
--       ivfflat 인덱스는 probes 설정 없이도 사용됨(default probes=1).
--       probes=1도 풀스캔 대비 압도적으로 빠름 — 핵심 목표(500/timeout 제거) 달성 가능.
--
-- 나머지 로직 변경 없음:
--   WHERE source_area = 'medical_issue_codes' 리터럴 → partial index 조건 일치 유지
--   ORDER BY r.embedding <=> query_embedding base table 직접 → ivfflat ANN 유지
--   LIMIT match_count * 4, min_similarity 미적용 → 후보 풀 확보 유지

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
  -- medical_issue_codes 전용 ANN 경로
  -- execute 'set local ivfflat.probes = 10' 제거 (42704 → 400 원인)
  -- ivfflat 인덱스는 probes=1 (default)로 작동 — 풀스캔 대비 충분히 빠름
  -- ----------------------------------------------------------------
  if source_area_filter = 'medical_issue_codes' then
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

  -- ----------------------------------------------------------------
  -- 분기 3: catch-all
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
