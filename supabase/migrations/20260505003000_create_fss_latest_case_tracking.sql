create table if not exists fss_latest_case_targets (
  id text primary key,
  fss_category text,
  insurance_type text,
  coverage_type text,
  title text,
  source_url text,
  source_status text,
  fetch_status text,
  fetched_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists fss_latest_case_fetch_logs (
  id uuid primary key default gen_random_uuid(),
  target_id text,
  source_url text,
  status text,
  message text,
  fetched_at timestamptz not null default now()
);

create index if not exists fss_latest_case_targets_fetch_status_idx
on fss_latest_case_targets(fetch_status);

create index if not exists fss_latest_case_targets_source_status_idx
on fss_latest_case_targets(source_status);

create index if not exists fss_latest_case_fetch_logs_target_id_idx
on fss_latest_case_fetch_logs(target_id);

drop trigger if exists set_fss_latest_case_targets_updated_at on fss_latest_case_targets;
create trigger set_fss_latest_case_targets_updated_at before update on fss_latest_case_targets
for each row execute function set_updated_at();
