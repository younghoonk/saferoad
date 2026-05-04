create table if not exists real_case_patterns (
  id text primary key,
  case_pattern_code text,
  insurance_type text,
  insurer_name text,
  claim_type text,
  accident_type text,
  diagnosis_code text,
  diagnosis_name text,
  dispute_category text,
  denial_reason_category text,
  insurer_position_summary text,
  customer_position_summary text,
  adjuster_strategy_summary text,
  rebuttal_points text[] not null default '{}',
  required_documents text[] not null default '{}',
  used_reference_areas text[] not null default '{}',
  outcome_type text,
  outcome_summary text,
  difficulty text,
  useful_search_keywords text[] not null default '{}',
  source_area text not null default 'real_case_patterns',
  source_type text not null default 'anonymized_real_case_pattern',
  trust_level text not null default 'internal_case_pattern',
  review_status text not null default 'needs_human_review',
  anonymization_status text not null default 'anonymized',
  contains_personal_data boolean not null default false,
  contains_sensitive_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists real_case_document_summaries (
  id text primary key,
  case_pattern_id text references real_case_patterns(id),
  document_type text,
  document_summary text,
  extracted_issue_points text[] not null default '{}',
  extracted_medical_points text[] not null default '{}',
  extracted_policy_points text[] not null default '{}',
  extracted_legal_points text[] not null default '{}',
  pii_removed boolean not null default true,
  sensitive_info_minimized boolean not null default true,
  source_area text not null default 'real_case_documents',
  source_type text not null default 'anonymized_document_summary',
  trust_level text not null default 'internal_case_pattern',
  review_status text not null default 'needs_human_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists real_case_anonymization_logs (
  id uuid primary key default gen_random_uuid(),
  case_pattern_id text,
  original_document_type text,
  anonymization_method text,
  removed_fields text[] not null default '{}',
  risk_level text,
  reviewer text,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
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
  'issue_playbooks',
  'medical_issue_codes',
  'real_case_patterns',
  'real_case_documents'
));

create index if not exists real_case_patterns_dispute_category_idx
on real_case_patterns(dispute_category);

create index if not exists real_case_patterns_outcome_type_idx
on real_case_patterns(outcome_type);

create index if not exists real_case_document_summaries_case_pattern_idx
on real_case_document_summaries(case_pattern_id);

drop trigger if exists set_real_case_patterns_updated_at on real_case_patterns;
create trigger set_real_case_patterns_updated_at before update on real_case_patterns
for each row execute function set_updated_at();

drop trigger if exists set_real_case_document_summaries_updated_at on real_case_document_summaries;
create trigger set_real_case_document_summaries_updated_at before update on real_case_document_summaries
for each row execute function set_updated_at();
