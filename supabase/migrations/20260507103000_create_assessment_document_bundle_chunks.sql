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

do $$
begin
  if not exists (select 1 from pg_type where typname = 'assessment_document_type') then
    create type assessment_document_type as enum (
      'policy_terms_bundle',
      'policy_schedule',
      'denial_letter',
      'medical_document',
      'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'assessment_document_section_type') then
    create type assessment_document_section_type as enum (
      'main_terms',
      'rider_terms',
      'disease_classification_table',
      'disability_table',
      'cancer_classification_table',
      'exclusion_clause',
      'diagnosis_definition',
      'hospitalization_definition',
      'surgery_definition',
      'payment_standard',
      'unknown'
    );
  end if;
end $$;

create or replace function classify_assessment_document_section(section_text text)
returns assessment_document_section_type
language plpgsql
immutable
as $$
declare
  normalized text := coalesce(section_text, '');
begin
  if normalized ~ '(장해분류표|장해지급률|영구장해|운동장해)' then
    return 'disability_table';
  end if;

  if normalized ~ '(대상이 되는 악성신생물|제자리신생물|행동양식 불명 또는 미상의 신생물|암분류표)' then
    return 'cancer_classification_table';
  end if;

  if normalized ~ '(별표|질병분류표)' then
    return 'disease_classification_table';
  end if;

  if normalized ~ '(특별약관|특약)' then
    return 'rider_terms';
  end if;

  if normalized ~ '(보험금을 지급하지 않는 사유|보상하지 않는 손해|면책)' then
    return 'exclusion_clause';
  end if;

  if normalized ~ '(진단확정|암의 진단|급성심근경색증의 진단확정|뇌졸중의 진단확정)' then
    return 'diagnosis_definition';
  end if;

  if normalized ~ '(입원의 정의|입원이라 함은)' then
    return 'hospitalization_definition';
  end if;

  if normalized ~ '(수술의 정의|수술이라 함은)' then
    return 'surgery_definition';
  end if;

  if normalized ~ '(지급기준|보험금 지급기준|지급률|보험금 지급)' then
    return 'payment_standard';
  end if;

  if length(trim(normalized)) > 0 then
    return 'main_terms';
  end if;

  return 'unknown';
end;
$$;

create table if not exists assessment_uploaded_documents (
  id uuid primary key default gen_random_uuid(),
  assessment_request_id uuid,
  case_id uuid,
  uploaded_by uuid references auth.users(id) on delete set null,
  document_type assessment_document_type not null default 'other',
  original_file_name text not null,
  display_file_name text not null,
  storage_bucket text,
  storage_path text,
  mime_type text,
  file_size_bytes bigint,
  file_sha256 text,
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'processing', 'completed', 'failed', 'unsupported')),
  official_citation_allowed boolean not null default false,
  citation_policy text not null default 'do_not_cite_as_official_ground',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessment_uploaded_documents_no_official_citation_check
    check (official_citation_allowed = false)
);

create table if not exists assessment_document_chunks (
  id uuid primary key default gen_random_uuid(),
  assessment_request_id uuid,
  case_id uuid,
  uploaded_document_id uuid not null references assessment_uploaded_documents(id) on delete cascade,
  document_type assessment_document_type not null,
  section_type assessment_document_section_type not null default 'unknown',
  chunk_no int not null,
  page_no int,
  title text,
  chunk_text text not null,
  content_hash text,
  token_count int,
  embedding_status text not null default 'pending'
    check (embedding_status in ('pending', 'processing', 'completed', 'failed', 'skipped')),
  embedding vector(1536),
  official_citation_allowed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessment_document_chunks_no_official_citation_check
    check (official_citation_allowed = false)
);

create unique index if not exists assessment_uploaded_documents_file_dedupe_idx
on assessment_uploaded_documents (
  coalesce(assessment_request_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(case_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(file_sha256, ''),
  original_file_name
);

create unique index if not exists assessment_document_chunks_document_chunk_no_idx
on assessment_document_chunks(uploaded_document_id, chunk_no);

create unique index if not exists assessment_document_chunks_content_dedupe_idx
on assessment_document_chunks(uploaded_document_id, content_hash)
where content_hash is not null;

create index if not exists assessment_uploaded_documents_request_idx
on assessment_uploaded_documents(assessment_request_id);

create index if not exists assessment_uploaded_documents_case_idx
on assessment_uploaded_documents(case_id);

create index if not exists assessment_uploaded_documents_type_idx
on assessment_uploaded_documents(document_type);

create index if not exists assessment_document_chunks_request_priority_idx
on assessment_document_chunks(assessment_request_id, document_type, section_type);

create index if not exists assessment_document_chunks_case_priority_idx
on assessment_document_chunks(case_id, document_type, section_type);

create index if not exists assessment_document_chunks_embedding_status_idx
on assessment_document_chunks(embedding_status);

create index if not exists assessment_document_chunks_text_idx
on assessment_document_chunks using gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(chunk_text, ''))
);

alter table assessment_uploaded_documents enable row level security;
alter table assessment_document_chunks enable row level security;

drop trigger if exists set_assessment_uploaded_documents_updated_at on assessment_uploaded_documents;
create trigger set_assessment_uploaded_documents_updated_at before update on assessment_uploaded_documents
for each row execute function set_updated_at();

drop trigger if exists set_assessment_document_chunks_updated_at on assessment_document_chunks;
create trigger set_assessment_document_chunks_updated_at before update on assessment_document_chunks
for each row execute function set_updated_at();

comment on table assessment_uploaded_documents is
'Case-scoped uploaded assessment documents. Policy terms are uploaded as one policy_terms_bundle containing main terms, riders, and attached tables.';

comment on table assessment_document_chunks is
'Case-scoped extracted document chunks. These chunks are not inserted into rag_master_chunks and must not be searched across unrelated cases.';

comment on column assessment_uploaded_documents.document_type is
'MVP document type: policy_terms_bundle, policy_schedule, denial_letter, medical_document, other.';

comment on column assessment_document_chunks.section_type is
'Classified section inside a policy terms bundle or other uploaded document.';

comment on column assessment_document_chunks.official_citation_allowed is
'Uploaded policy chunks may support case review but must not be cited as common official RAG grounds.';
