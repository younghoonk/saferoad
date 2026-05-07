create table if not exists rag_practice_playbooks (
  id text primary key,
  title text not null,
  category text,
  sub_category text,
  issue_type text,
  scenario_summary text,
  practice_points text[] not null default '{}',
  customer_arguments text[] not null default '{}',
  insurer_arguments text[] not null default '{}',
  rebuttal_points text[] not null default '{}',
  required_documents text[] not null default '{}',
  useful_search_keywords text[] not null default '{}',
  source_title text,
  source_url text,
  source_domain text,
  source_area text not null default 'practice_playbooks',
  source_type text not null default 'internal_practice_playbook',
  trust_level text not null default 'internal_practice_playbook',
  review_status text not null default 'needs_human_review',
  official_citation_allowed boolean not null default false,
  content_hash text not null,
  duplicate_group_key text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table rag_master_chunks
add column if not exists content_hash text;

alter table rag_master_chunks
add column if not exists duplicate_group_key text;

alter table rag_master_chunks
drop constraint if exists rag_master_chunks_source_area_check;

alter table rag_master_chunks
add constraint rag_master_chunks_source_area_check
check (source_area in (
  'precedents',
  'terms_standards',
  'fss_dispute_cases',
  'medical_knowledge',
  'legal_statutes',
  'issue_playbooks',
  'medical_issue_codes',
  'real_case_patterns',
  'real_case_documents',
  'practice_playbooks'
));

create unique index if not exists rag_practice_playbooks_content_hash_idx
on rag_practice_playbooks(content_hash);

create index if not exists rag_practice_playbooks_duplicate_group_key_idx
on rag_practice_playbooks(duplicate_group_key);

create index if not exists rag_practice_playbooks_category_idx
on rag_practice_playbooks(category);

create unique index if not exists rag_master_chunks_practice_content_hash_idx
on rag_master_chunks(source_area, content_hash)
where source_area = 'practice_playbooks' and content_hash is not null;

create index if not exists rag_master_chunks_duplicate_group_key_idx
on rag_master_chunks(duplicate_group_key)
where duplicate_group_key is not null;

drop trigger if exists set_rag_practice_playbooks_updated_at on rag_practice_playbooks;
create trigger set_rag_practice_playbooks_updated_at before update on rag_practice_playbooks
for each row execute function set_updated_at();
