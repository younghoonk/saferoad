create table if not exists priority_issue_playbooks (
  id text primary key,
  category text,
  sub_category text,
  issue_type text,
  title text not null,
  scenario_summary text,
  key_arguments text[] not null default '{}',
  counter_arguments text[] not null default '{}',
  required_documents text[] not null default '{}',
  useful_search_keywords text[] not null default '{}',
  expected_source_areas text[] not null default '{}',
  caution_notes text,
  source_area text not null default 'issue_playbooks',
  source_type text not null default 'internal_issue_playbook',
  trust_level text not null default 'internal_playbook',
  review_status text not null default 'needs_human_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rag_keyword_aliases (
  id text primary key,
  domain text,
  canonical_term text not null,
  aliases text[] not null default '{}',
  related_diagnosis_codes text[] not null default '{}',
  related_issue_types text[] not null default '{}',
  related_source_areas text[] not null default '{}',
  search_boost_keywords text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  'issue_playbooks'
));

create index if not exists priority_issue_playbooks_category_idx
on priority_issue_playbooks(category);

create index if not exists rag_keyword_aliases_domain_idx
on rag_keyword_aliases(domain);

drop trigger if exists set_priority_issue_playbooks_updated_at on priority_issue_playbooks;
create trigger set_priority_issue_playbooks_updated_at before update on priority_issue_playbooks
for each row execute function set_updated_at();

drop trigger if exists set_rag_keyword_aliases_updated_at on rag_keyword_aliases;
create trigger set_rag_keyword_aliases_updated_at before update on rag_keyword_aliases
for each row execute function set_updated_at();
