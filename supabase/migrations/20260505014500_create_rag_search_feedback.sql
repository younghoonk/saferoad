create table if not exists rag_search_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null,
  case_id uuid null,
  feature_name text,
  input_text text,
  generated_query text,
  diagnosis_codes text[] not null default '{}',
  issue_types text[] not null default '{}',
  source_area_filters text[] not null default '{}',
  returned_chunk_ids text[] not null default '{}',
  returned_count int,
  max_similarity double precision,
  source_area_counts jsonb not null default '{}'::jsonb,
  search_status text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists rag_search_feedback (
  id uuid primary key default gen_random_uuid(),
  search_log_id uuid references rag_search_logs(id) on delete cascade,
  feedback_type text,
  rating int,
  feedback_text text,
  missing_keywords text[] not null default '{}',
  missing_source_areas text[] not null default '{}',
  wrong_chunk_ids text[] not null default '{}',
  useful_chunk_ids text[] not null default '{}',
  reviewer_role text,
  created_at timestamptz not null default now()
);

create table if not exists rag_search_improvement_tasks (
  id uuid primary key default gen_random_uuid(),
  search_log_id uuid null references rag_search_logs(id) on delete set null,
  feedback_id uuid null references rag_search_feedback(id) on delete set null,
  task_type text,
  priority text,
  status text not null default 'open',
  issue_summary text,
  recommended_action text,
  related_query text,
  related_diagnosis_codes text[] not null default '{}',
  related_issue_types text[] not null default '{}',
  related_source_areas text[] not null default '{}',
  assigned_to text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table rag_search_logs enable row level security;
alter table rag_search_feedback enable row level security;
alter table rag_search_improvement_tasks enable row level security;

drop policy if exists rag_search_logs_insert_own on rag_search_logs;
create policy rag_search_logs_insert_own
on rag_search_logs for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists rag_search_feedback_insert_own_log on rag_search_feedback;
create policy rag_search_feedback_insert_own_log
on rag_search_feedback for insert
to authenticated
with check (
  exists (
    select 1
    from rag_search_logs l
    where l.id = search_log_id
      and l.user_id = auth.uid()
  )
);

create index if not exists rag_search_logs_user_id_idx
on rag_search_logs(user_id);

create index if not exists rag_search_logs_case_id_idx
on rag_search_logs(case_id);

create index if not exists rag_search_logs_feature_name_idx
on rag_search_logs(feature_name);

create index if not exists rag_search_logs_search_status_idx
on rag_search_logs(search_status);

create index if not exists rag_search_feedback_search_log_id_idx
on rag_search_feedback(search_log_id);

create index if not exists rag_search_feedback_feedback_type_idx
on rag_search_feedback(feedback_type);

create index if not exists rag_search_improvement_tasks_status_idx
on rag_search_improvement_tasks(status);

create index if not exists rag_search_improvement_tasks_task_type_idx
on rag_search_improvement_tasks(task_type);
