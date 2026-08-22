-- Fix: Remove country filter from park candidate generation
-- All parks currently have NULL country, so the previous filter blocked all candidates.
-- Dataset is small (279 parks ~39k pairs), so global self-join is fast.

create or replace function public.generate_park_candidates(p_threshold numeric default 0.6)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  insert into public.park_dupe_candidates (park_a_id, park_b_id, similarity)
  select
    a.id,
    b.id,
    word_similarity(a.name, b.name)
  from public.parks a
  join public.parks b
    on a.id < b.id
  where word_similarity(a.name, b.name) > p_threshold
  on conflict (park_a_id, park_b_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke execute on function public.generate_park_candidates(numeric)
  from public, anon, authenticated;
grant execute on function public.generate_park_candidates(numeric)
  to service_role;

-- Helper for dry-run: count candidates without inserting
create or replace function public.count_park_candidates(p_threshold numeric default 0.6)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)
  from public.parks a
  join public.parks b
    on a.id < b.id
  where word_similarity(a.name, b.name) > p_threshold;
$$;

revoke execute on function public.count_park_candidates(numeric)
  from public, anon, authenticated;
grant execute on function public.count_park_candidates(numeric)
  to service_role;