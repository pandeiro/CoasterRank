-- User feedback: lightweight bug reports / confusion reports / missing-data
-- notes / ideas, submitted from a modal anywhere in the app (no navigation).
-- Parallel to coaster_submissions (which stays coaster-data-shaped: stat
-- payload CHECK + approve→create-coaster). Feedback is conversational:
-- categories + auto-captured context + a reply thread in both directions.
-- RLS/cap/Telegram mirror the submissions patterns.

-- ── Enums ──────────────────────────────────────────────────────────────────
create type feedback_category as enum ('bug', 'confusing', 'missing', 'idea');

-- Thread state (ping-pong maintained by the reply trigger):
--   open    = needs admin attention (fresh feedback, or the user replied)
--   replied = admin responded, waiting on the user
--   closed  = admin is done; user replies are locked (admin reply reopens)
create type feedback_status as enum ('open', 'replied', 'closed');

-- ── Tables ─────────────────────────────────────────────────────────────────
create table public.user_feedback (
  id                   uuid primary key default gen_random_uuid(),
  category             feedback_category not null,
  message              text not null,
  context              jsonb not null default '{}'::jsonb,
  submitted_by         uuid not null references auth.users (id) on delete cascade,
  status               feedback_status not null default 'open',
  -- Set when the submitter has viewed activity since their last action
  -- (drives the "New" pill on their thread list). Cleared via RPC only —
  -- submitters get no UPDATE grant on the row itself.
  seen_by_submitter_at timestamptz,
  created_at           timestamptz not null default now()
);

-- Reply thread. author is_admin is derived at read time via the profiles
-- embed (admins are the only authors except the submitter's own replies).
create table public.user_feedback_replies (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.user_feedback (id) on delete cascade,
  author_id   uuid not null references auth.users (id) on delete cascade,
  message     text not null,
  created_at  timestamptz not null default now()
);

create index user_feedback_submitted_by_idx
  on public.user_feedback (submitted_by, created_at desc);
create index user_feedback_status_idx on public.user_feedback (status);
create index user_feedback_replies_feedback_idx
  on public.user_feedback_replies (feedback_id, created_at);

-- Message limits mirror the submissions note CHECK (1..2000 after trim).
alter table public.user_feedback
  add constraint user_feedback_message_check
  check (char_length(trim(message)) between 1 and 2000);
alter table public.user_feedback_replies
  add constraint user_feedback_replies_message_check
  check (char_length(trim(message)) between 1 and 2000);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.user_feedback enable row level security;
alter table public.user_feedback_replies enable row level security;

-- Anti-abuse cap, mirroring submission_within_cap(): at most 5 open threads
-- per user; replies only happen after an admin responds, so the cap self-heals.
create or replace function public.feedback_within_cap()
returns boolean
language sql
security definer
set search_path = public
as $$
  select (
    select count(*)
    from public.user_feedback
    where submitted_by = auth.uid() and status = 'open'
  ) < 5;
$$;

create policy "feedback owner insert"
  on public.user_feedback for insert
  with check (
    submitted_by = auth.uid()
    and public.user_email_verified(auth.uid())
    and public.feedback_within_cap()
  );

create policy "feedback owner or admin select"
  on public.user_feedback for select
  using (submitted_by = auth.uid() or public.is_admin());

create policy "feedback admin update"
  on public.user_feedback for update
  using (public.is_admin()) with check (public.is_admin());

create policy "feedback admin delete"
  on public.user_feedback for delete
  using (public.is_admin());

create policy "replies owner or admin select"
  on public.user_feedback_replies for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.user_feedback f
      where f.id = feedback_id and f.submitted_by = auth.uid()
    )
  );

-- Users may reply only on their own feedback AND only once an admin has
-- responded (status = 'replied'). Admins may reply anywhere, including
-- closed threads (which reopens them — see the trigger below).
create policy "replies author insert"
  on public.user_feedback_replies for insert
  with check (
    author_id = auth.uid()
    and (
      public.is_admin()
      or exists (
        select 1 from public.user_feedback f
        where f.id = feedback_id and f.submitted_by = auth.uid() and f.status = 'replied'
      )
    )
  );

grant select, insert, update, delete on public.user_feedback to authenticated;
grant select, insert on public.user_feedback_replies to authenticated;

-- ── Seen RPC ───────────────────────────────────────────────────────────────
-- Submitters have no UPDATE grant; the RPC stamps their own unseen rows only.
create or replace function public.mark_own_feedback_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.user_feedback
  set seen_by_submitter_at = now()
  where submitted_by = auth.uid()
    and seen_by_submitter_at is null;
$$;

revoke execute on function public.mark_own_feedback_seen() from public, anon;
grant execute on function public.mark_own_feedback_seen() to authenticated;

-- ── Reply trigger: status ping-pong + Telegram nudge on user replies ───────
-- Security definer because submitters have no UPDATE grant on user_feedback;
-- auth.uid()/is_admin() still read the request JWT, so authorship checks stay
-- honest. Admin reply → 'replied' (waiting on user). User reply → 'open'
-- (resurfaces in the admin queue) + a Telegram alert so the admin knows.
create or replace function public.trigger_on_feedback_reply()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_author_is_admin boolean;
  v_email text;
  v_username text;
begin
  select is_admin into v_author_is_admin
  from public.profiles
  where id = new.author_id;

  if coalesce(v_author_is_admin, false) then
    update public.user_feedback
    set status = 'replied'
    where id = new.feedback_id;
    return new;
  end if;

  update public.user_feedback
  set status = 'open'
  where id = new.feedback_id;

  -- User reply nudge — same synthetic-user filter as the other events.
  select email into v_email
  from auth.users
  where id = new.author_id;
  if v_email is not null and lower(v_email) like '%@test.coasterrank.dev' then
    return new;
  end if;

  select username into v_username
  from public.profiles
  where id = new.author_id;
  v_username := coalesce(v_username, split_part(v_email, '@', 1), 'unknown');

  perform public.send_telegram_event(
    'feedback_events',
    '💬 Reply from @' || v_username || ': "'
      || public.telegram_safe_text(new.message, 80) || '"'
  );

  return new;
end;
$$;

create trigger on_feedback_reply_status_and_notify
  after insert on public.user_feedback_replies
  for each row execute function public.trigger_on_feedback_reply();

-- ── Telegram: new feedback ─────────────────────────────────────────────────
create or replace function public.trigger_notify_on_feedback()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text;
  v_username text;
  v_category text;
begin
  select email into v_email
  from auth.users
  where id = new.submitted_by;
  if v_email is not null and lower(v_email) like '%@test.coasterrank.dev' then
    return new;
  end if;

  select username into v_username
  from public.profiles
  where id = new.submitted_by;
  v_username := coalesce(v_username, split_part(v_email, '@', 1), 'unknown');

  v_category := case new.category
    when 'bug' then '🐛 Bug'
    when 'confusing' then '😕 Confusing'
    when 'missing' then '➕ Missing'
    when 'idea' then '💡 Idea'
  end;

  perform public.send_telegram_event(
    'feedback_events',
    '💬 ' || v_category || ': "'
      || public.telegram_safe_text(new.message, 80)
      || '" — by @' || v_username
      || coalesce(' · ' || public.telegram_safe_text(new.context ->> 'page', 60), '')
  );

  return new;
end;
$$;

create trigger on_feedback_created_notify_telegram
  after insert on public.user_feedback
  for each row execute function public.trigger_notify_on_feedback();

-- ── Control Panel kill-switch seed ─────────────────────────────────────────
insert into public.app_settings (key, enabled, label) values
  ('feedback_events', true, 'Feedback events')
on conflict (key) do update set label = excluded.label;
