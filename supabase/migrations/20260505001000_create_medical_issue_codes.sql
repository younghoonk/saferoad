create table if not exists medical_issue_codes (
  id text primary key,
  diagnosis_code text,
  diagnosis_name text,
  code_group text,
  body_system text,
  insurance_issue_category text,
  related_claim_types text[] not null default '{}',
  common_customer_expression text[] not null default '{}',
  common_document_expression text[] not null default '{}',
  common_tests text[] not null default '{}',
  key_medical_findings text[] not null default '{}',
  insurance_relevance text,
  causation_points text[] not null default '{}',
  pre_existing_condition_points text[] not null default '{}',
  disclosure_duty_points text[] not null default '{}',
  disability_points text[] not null default '{}',
  hospitalization_points text[] not null default '{}',
  surgery_points text[] not null default '{}',
  required_documents text[] not null default '{}',
  useful_search_keywords text[] not null default '{}',
  related_source_areas text[] not null default '{}',
  caution_notes text,
  source_area text not null default 'medical_issue_codes',
  source_type text not null default 'internal_medical_issue_code',
  trust_level text not null default 'internal_review_required',
  review_status text not null default 'needs_human_review',
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
  'issue_playbooks',
  'medical_issue_codes'
));

create index if not exists medical_issue_codes_diagnosis_code_idx
on medical_issue_codes(diagnosis_code);

create index if not exists medical_issue_codes_body_system_idx
on medical_issue_codes(body_system);

create index if not exists medical_issue_codes_issue_category_idx
on medical_issue_codes(insurance_issue_category);

drop trigger if exists set_medical_issue_codes_updated_at on medical_issue_codes;
create trigger set_medical_issue_codes_updated_at before update on medical_issue_codes
for each row execute function set_updated_at();
