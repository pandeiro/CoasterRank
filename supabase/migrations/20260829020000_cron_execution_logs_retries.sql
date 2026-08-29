-- Track how many retries rpcWithRetry used before success/failure.
-- Zero means first-attempt success (or a non-PGRST303 failure).
-- Non-zero on success = the underlying clock-drift rate is real.
-- Non-zero on failure = retries were exhausted.

alter table public.cron_execution_logs
  add column retries_used integer not null default 0;
