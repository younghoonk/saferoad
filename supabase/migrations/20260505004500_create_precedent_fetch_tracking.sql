create table if not exists precedent_search_targets (
  id text primary key,
  category text,
  sub_category text,
  query text,
  search_scope text,
  expected_issue_types text[] not null default '{}',
  expected_source_keywords text[] not null default '{}',
  fetch_status text,
  source_status text,
  fetched_count int not null default 0,
  imported_count int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists precedent_fetch_logs (
  id uuid primary key default gen_random_uuid(),
  target_id text,
  query text,
  status text,
  message text,
  fetched_at timestamptz not null default now()
);

create index if not exists precedent_search_targets_fetch_status_idx
on precedent_search_targets(fetch_status);

create index if not exists precedent_search_targets_category_idx
on precedent_search_targets(category);

create index if not exists precedent_fetch_logs_target_id_idx
on precedent_fetch_logs(target_id);

drop trigger if exists set_precedent_search_targets_updated_at on precedent_search_targets;
create trigger set_precedent_search_targets_updated_at before update on precedent_search_targets
for each row execute function set_updated_at();
