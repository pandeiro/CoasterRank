-- Anti-abuse (PLAN §10 Phase 8): cap how many PENDING coaster submissions a
-- user may have open at once. Enforced in the RLS insert policy so it holds
-- regardless of client behavior; the SPA also pre-checks for a friendlier
-- message. Reviewed (approved/rejected) submissions never count against the
-- cap, so a responsive moderation queue unblocks users automatically.

-- Security-definer so the policy can count the caller's rows without hitting
-- the very policy it is evaluating (no RLS recursion).
create or replace function public.submission_within_cap()
returns boolean
language sql
security definer
set search_path = public
as $$
  select (
    select count(*)
    from public.coaster_submissions
    where submitted_by = auth.uid() and status = 'pending'
  ) < 5;
$$;

drop policy "submissions owner insert" on public.coaster_submissions;
create policy "submissions owner insert"
  on public.coaster_submissions for insert
  with check (
    submitted_by = auth.uid()
    and public.user_email_verified(auth.uid())
    and public.submission_within_cap()
  );
