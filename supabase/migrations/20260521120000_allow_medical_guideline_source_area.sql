-- Allow medical_guideline source_area in rag_master_chunks.
-- Track 3: Medical guideline DB migration support.

alter table public.rag_master_chunks
drop constraint if exists rag_master_chunks_source_area_check;

alter table public.rag_master_chunks
add constraint rag_master_chunks_source_area_check
check (source_area in (
  'precedents',
  'terms_standards',
  'fss_dispute_cases',
  'medical_guideline',
  'medical_knowledge',
  'legal_statutes',
  'issue_playbooks',
  'medical_issue_codes',
  'real_case_patterns',
  'real_case_documents',
  'practice_playbooks',
  'dispute_resolution_cases'
));
