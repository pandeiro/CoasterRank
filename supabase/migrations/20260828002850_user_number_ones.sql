-- Track each time a user's #1 ranked coaster changes.
-- Append-only log: one row per user per time they gain a new #1.

create table public.user_number_ones (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users (id) on delete cascade,
  coaster_id          uuid not null references public.coasters (id) on delete cascade,
  previous_coaster_id uuid references public.coasters (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index user_number_ones_user_idx on public.user_number_ones (user_id, created_at);

-- RLS ----------------------------------------------------------------
alter table public.user_number_ones enable row level security;

create policy "user_number_ones own select"
  on public.user_number_ones for select
  using (user_id = auth.uid());

create policy "user_number_ones own insert"
  on public.user_number_ones for insert
  with check (user_id = auth.uid());

grant select, insert on public.user_number_ones to authenticated;

-- Trigger: log when a user's rank=1 changes -------------------------
create or replace function public.log_user_number_one()
returns trigger
language plpgsql
as $$
declare
  prev_id uuid;
begin
  if NEW.rank = 1 and (OLD.rank IS DISTINCT FROM 1) then
    select coaster_id into prev_id
      from public.user_rides
      where user_id = NEW.user_id and rank = 1 and coaster_id != NEW.coaster_id
      limit 1;

    insert into public.user_number_ones (user_id, coaster_id, previous_coaster_id)
    values (NEW.user_id, NEW.coaster_id, prev_id);
  end if;
  return NEW;
end;
$$;

create trigger user_number_one_log
  after update on public.user_rides
  for each row
  execute function public.log_user_number_one();
