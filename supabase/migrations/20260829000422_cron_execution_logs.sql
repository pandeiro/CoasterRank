-- Observability: log every recompute-rankings execution (success + failure).
-- The Edge Function writes rows via service_role (bypasses RLS).
-- The Admin Dashboard reads them to show "last successful run" + error history.

create table public.cron_execution_logs (
  id             uuid primary key default gen_random_uuid(),
  status         text not null check (status in ('success', 'error')),
  duration_ms    integer not null,
  trigger_source text not null check (trigger_source in ('pg_cron', 'manual')),
  iterations     integer,
  converged      boolean,
  pairs          integer,
  updated        integer,
  error_message  text,
  created_at     timestamptz not null default now()
);

-- Fast lookups for "last run" / "last error" by status + time.
create index cron_execution_logs_status_idx on public.cron_execution_logs (status, created_at desc);

-- RLS ----------------------------------------------------------------
alter table public.cron_execution_logs enable row level security;

create policy "Admins can view execution logs"
  on public.cron_execution_logs
  for select
  using (public.is_admin());

-- Edge Function inserts via service_role (bypasses RLS).
grant insert on public.cron_execution_logs to service_role;
grant select on public.cron_execution_logs to authenticated;
