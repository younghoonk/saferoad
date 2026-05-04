create extension if not exists vector;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists court_precedents (
  id uuid primary key default gen_random_uuid(),
  record_id text not null unique,
  source_type text,
  title text not null,
  case_number text,
  court_or_agency text,
  decision_date date,
  precedent_categories text,
  insurance_type text,
  accident_type text,
  issue text,
  summary text,
  key_points text,
  outcome text,
  conclusion text,
  keywords text,
  source_url text,
  source_reference text,
  source_status text,
  full_text_excerpt text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists terms_source_documents (
  id uuid primary key default gen_random_uuid(),
  source_document_id text not null unique,
  source_group text,
  document_type text,
  terms_category text,
  title text not null,
  publisher text,
  effective_from date,
  effective_to date,
  version text,
  source_url text,
  official_reference_url text,
  raw_pdf_path text,
  raw_text_path text,
  source_status text,
  notes text,
  pdf_file_size_bytes bigint,
  pdf_sha256 text,
  text_file_size_bytes bigint,
  text_sha256 text,
  collected_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists terms_raw_chunks (
  id uuid primary key default gen_random_uuid(),
  chunk_id text not null unique,
  source_document_id text references terms_source_documents(source_document_id),
  source_group text,
  source_type text,
  document_type text,
  terms_category text,
  title text not null,
  page_no int,
  chunk_no int,
  raw_text text not null,
  effective_from date,
  effective_to date,
  source_url text,
  embedding_status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists fss_dispute_cases (
  id uuid primary key default gen_random_uuid(),
  record_id text not null unique,
  source_type text,
  title text not null,
  case_number text,
  court_or_agency text,
  decision_date date,
  insurance_type text,
  accident_type text,
  precedent_categories text,
  issue text,
  summary text,
  key_points text,
  outcome text,
  conclusion text,
  keywords text,
  latest_flag boolean,
  published_batch text,
  published_date text,
  source_status text,
  pdf_page text,
  printed_page text,
  source_reference text,
  source_url text,
  source_category text,
  full_text_excerpt text,
  embedding_status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists medical_source_documents (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique,
  source_type text not null,
  title text not null,
  publisher text,
  source_url text,
  scope text,
  source_status text,
  update_frequency text,
  last_checked_at date,
  copyright_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists medical_knowledge_records (
  id uuid primary key default gen_random_uuid(),
  record_id text not null unique,
  category text,
  body_system text,
  diagnosis_name text not null,
  diagnosis_code text,
  common_synonyms text,
  issue_type text,
  medical_summary text,
  common_tests text,
  key_findings text,
  treatment_summary text,
  insurance_relevance text,
  causation_points text,
  pre_existing_condition_points text,
  disability_points text,
  hospitalization_points text,
  surgery_points text,
  caution_notes text,
  source_ids text,
  source_status text,
  priority int not null default 3,
  last_reviewed_at date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists medical_kcd_priority_codes (
  id uuid primary key default gen_random_uuid(),
  code_id text not null unique,
  kcd_code text not null,
  korean_name text not null,
  category text,
  insurance_relevance text,
  source_ids text,
  verification_status text,
  last_reviewed_at date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists legal_source_documents (
  id uuid primary key default gen_random_uuid(),
  source_document_id text not null unique,
  source_area text not null default 'legal_statutes',
  law_name text not null,
  law_alias text,
  source_type text,
  publisher text,
  jurisdiction text,
  effective_date date,
  promulgation_info text,
  source_url text,
  source_status text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists legal_articles (
  id uuid primary key default gen_random_uuid(),
  article_id text not null unique,
  source_document_id text references legal_source_documents(source_document_id),
  law_name text not null,
  law_part text,
  article_no text not null,
  article_title text,
  article_text text not null,
  effective_date date,
  source_url text,
  issue_tags text,
  priority int not null default 3,
  article_text_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists legal_article_targets (
  id uuid primary key default gen_random_uuid(),
  target_id text not null unique,
  source_document_id text references legal_source_documents(source_document_id),
  law_name text not null,
  article_no text,
  article_title text,
  jo_code text,
  fetch_method text,
  source_url text,
  priority int not null default 3,
  issue_tags text,
  status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rag_master_chunks (
  id uuid primary key default gen_random_uuid(),
  chunk_id text not null unique,
  source_area text not null check (source_area in (
    'precedents',
    'terms_standards',
    'fss_dispute_cases',
    'medical_knowledge',
    'legal_statutes'
  )),
  source_type text,
  source_document_id text,
  source_record_id text,
  source_reference text,
  title text not null,
  chunk_text text not null,
  summary text,
  keywords text,
  source_url text,
  page_no int,
  chunk_no int,
  effective_from date,
  effective_to date,
  trust_level text,
  review_status text not null default 'unreviewed',
  embedding_status text not null default 'pending',
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists rag_master_chunks_source_dedupe_idx
on rag_master_chunks (
  source_area,
  title,
  coalesce(source_reference, source_document_id, source_record_id, chunk_id)
);

create index if not exists court_precedents_title_idx on court_precedents(title);
create index if not exists terms_raw_chunks_document_idx on terms_raw_chunks(source_document_id);
create index if not exists fss_dispute_cases_title_idx on fss_dispute_cases(title);
create index if not exists rag_master_chunks_source_area_idx on rag_master_chunks(source_area);
create index if not exists rag_master_chunks_embedding_status_idx on rag_master_chunks(embedding_status);
create index if not exists rag_master_chunks_text_idx
on rag_master_chunks using gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(chunk_text, '') || ' ' || coalesce(keywords, ''))
);

drop trigger if exists set_court_precedents_updated_at on court_precedents;
create trigger set_court_precedents_updated_at before update on court_precedents
for each row execute function set_updated_at();

drop trigger if exists set_terms_source_documents_updated_at on terms_source_documents;
create trigger set_terms_source_documents_updated_at before update on terms_source_documents
for each row execute function set_updated_at();

drop trigger if exists set_terms_raw_chunks_updated_at on terms_raw_chunks;
create trigger set_terms_raw_chunks_updated_at before update on terms_raw_chunks
for each row execute function set_updated_at();

drop trigger if exists set_fss_dispute_cases_updated_at on fss_dispute_cases;
create trigger set_fss_dispute_cases_updated_at before update on fss_dispute_cases
for each row execute function set_updated_at();

drop trigger if exists set_medical_source_documents_updated_at on medical_source_documents;
create trigger set_medical_source_documents_updated_at before update on medical_source_documents
for each row execute function set_updated_at();

drop trigger if exists set_medical_knowledge_records_updated_at on medical_knowledge_records;
create trigger set_medical_knowledge_records_updated_at before update on medical_knowledge_records
for each row execute function set_updated_at();

drop trigger if exists set_medical_kcd_priority_codes_updated_at on medical_kcd_priority_codes;
create trigger set_medical_kcd_priority_codes_updated_at before update on medical_kcd_priority_codes
for each row execute function set_updated_at();

drop trigger if exists set_legal_source_documents_updated_at on legal_source_documents;
create trigger set_legal_source_documents_updated_at before update on legal_source_documents
for each row execute function set_updated_at();

drop trigger if exists set_legal_articles_updated_at on legal_articles;
create trigger set_legal_articles_updated_at before update on legal_articles
for each row execute function set_updated_at();

drop trigger if exists set_legal_article_targets_updated_at on legal_article_targets;
create trigger set_legal_article_targets_updated_at before update on legal_article_targets
for each row execute function set_updated_at();

drop trigger if exists set_rag_master_chunks_updated_at on rag_master_chunks;
create trigger set_rag_master_chunks_updated_at before update on rag_master_chunks
for each row execute function set_updated_at();

create or replace function match_rag_master_chunks(
  query_embedding vector(1536),
  match_count int default 12,
  source_area_filter text default null,
  min_similarity float default 0.65
)
returns table (
  id uuid,
  source_area text,
  source_type text,
  title text,
  summary text,
  chunk_text text,
  keywords text,
  source_url text,
  page_no int,
  trust_level text,
  similarity float
)
language sql stable
as $$
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
  from rag_master_chunks r
  where r.embedding is not null
    and (source_area_filter is null or r.source_area = source_area_filter)
    and 1 - (r.embedding <=> query_embedding) >= min_similarity
  order by r.embedding <=> query_embedding
  limit match_count;
$$;
