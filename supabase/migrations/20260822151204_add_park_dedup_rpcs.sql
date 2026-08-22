-- Park dedup RPC functions
-- Applied via: PR → merge to main → CI supabase db push (never run db push locally)

-- 1. Bulk park candidate generation via single SQL self-join (uses pg_trgm word_similarity)
--    Replaces O(N²) RPC calls in generate-park-candidates.ts
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
    on a.country = b.country
   and a.id < b.id
  where a.country is not null
    and word_similarity(a.name, b.name) > p_threshold
  on conflict (park_a_id, park_b_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke execute on function public.generate_park_candidates(numeric)
  from public, anon, authenticated;
grant execute on function public.generate_park_candidates(numeric)
  to service_role;

-- 2. Atomic park merge helper (used by review-parks CLI via supabaseAdmin.rpc)
create or replace function public.apply_park_merge(
  p_canonical_id  uuid,
  p_duplicate_id  uuid,
  p_candidate_id  uuid,
  p_reason        text,
  p_reviewed_by   text default 'cli'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Re-point all coasters from duplicate to canonical
  update public.coasters
    set park_id = p_canonical_id
  where park_id = p_duplicate_id;

  -- Delete the duplicate park
  delete from public.parks where id = p_duplicate_id;

  -- Mark candidate as resolved
  update public.park_dupe_candidates
    set resolved = true,
        reviewed_by = p_reviewed_by
  where id = p_candidate_id;
end;
$$;

revoke execute on function public.apply_park_merge(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_park_merge(uuid, uuid, uuid, text, text)
  to service_role;