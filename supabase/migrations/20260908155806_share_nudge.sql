-- Share nudge v2 (PLAN §2): one-shot, idle-settled banner on /me — the
-- replacement for the scrapped ranking-milestone share CTAs (they got in the
-- way; the placement is being rethought as a subtle nudge).
--
-- Eligibility, computed server-side in ONE rpc called from the My Coasters
-- mount (never the board or coaster/park detail pages, never a modal):
--   * profiles.share_nudge_shown_at IS NULL   (one-shot across all sessions)
--   * ranked_count >= 5                       (floor — nobody's "settled" early)
--   * last edit on ranked rides >= 48h ago    (settled, not mid-session tweaking)
--
-- The rpc decides AND claims: the claim is an UPDATE guarded by
-- share_nudge_shown_at IS NULL, so exactly one request/tab ever sees
-- eligible = true. Dismiss is client-session UI state — there is no
-- "dismissed" write; the one-shot claim is what keeps it subtle.

alter table public.profiles
  add column share_nudge_shown_at timestamptz;

-- Deliberately NOT added to the profiles update-column whitelist (the
-- rpc below is the only writer, so client DML can never touch it —
-- same rule as is_admin).

-- The idle clock needs a truthful "last edit" per ride. user_rides.updated_at
-- was stamped only by a BEFORE UPDATE trigger firing on rank changes, so rows
-- whose rank was set by the initial INSERT (add-to-list flow) or directly by
-- the import rpc had updated_at = NULL forever — imported / once-ranked lists
-- (the nudge's main audience) could never compute an idle window. Stamp
-- INSERTs too. The UPDATE trigger's rank-change-only WHEN clause is unchanged
-- (batched re-rank upserts must not touch unchanged rows).
create trigger user_rides_inserted_at
  before insert on public.user_rides
  for each row
  execute function public.set_user_rides_updated_at();

-- Baseline existing rows: their true last edit is unknown but old, and the
-- migration timestamp is the honest conservative floor — long-idle lists
-- become eligible ~48h after this deploys, and nobody is misclassified as
-- "recently active" (now() is never older than the truth).
update public.user_rides
  set updated_at = now()
  where updated_at is null;

create or replace function public.share_nudge_eligibility()
returns table (eligible boolean, ranked_count integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user_id   uuid;
  v_count     integer;
  v_last_edit timestamptz;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return query select false, 0;
  end if;

  -- One-shot: once shown (any prior session/tab), never again.
  if exists (
    select 1 from public.profiles
    where id = v_user_id and share_nudge_shown_at is not null
  ) then
    return query select false, 0;
  end if;

  select count(*)::integer, max(r.updated_at)
    into v_count, v_last_edit
  from public.user_rides r
  where r.user_id = v_user_id
    and r.rank is not null;

  -- Floor: nobody's "settled" this early (also covers the no-edit-yet edge,
  -- which the INSERT trigger above makes a practical impossibility).
  if v_count < 5 or v_last_edit is null then
    return query select false, v_count;
  end if;

  -- Settled = idle; a user mid-session tweaking their list stays silent.
  if v_last_edit > now() - interval '48 hours' then
    return query select false, v_count;
  end if;

  -- Write-on-render claim. The IS NULL guard makes a racing tab's UPDATE a
  -- zero-row no-op; found = this call flipped the row and owns the banner.
  update public.profiles
    set share_nudge_shown_at = now()
    where id = v_user_id
      and share_nudge_shown_at is null;

  return query select found, v_count;
end;
$$;

revoke execute on function public.share_nudge_eligibility() from public, anon;
grant execute on function public.share_nudge_eligibility() to authenticated;

comment on column public.profiles.share_nudge_shown_at is
  'When the one-shot share nudge was claimed on /me; NULL = never shown. Written only by share_nudge_eligibility() (guarded IS NULL claim), never by client DML.';

comment on function public.share_nudge_eligibility() is
  'One-shot share-nudge gate for the My Coasters mount: eligible only when the rider has >= 5 ranked coasters whose last edit is >= 48h old and profiles.share_nudge_shown_at is still NULL. Decides and claims atomically via a guarded UPDATE, so exactly one request/tab ever sees eligible = true.';
