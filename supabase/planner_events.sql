create extension if not exists pgcrypto;

create table if not exists public.planner_events (
	id uuid primary key default gen_random_uuid(),
	user_id text not null,
	event_date date not null,
	event_time time not null,
	title text not null,
	note text,
	tag text not null check (tag in ('deadline', 'celebration', 'simple')),
	created_at timestamptz not null default timezone('utc', now()),
	updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists planner_events_user_id_event_date_idx
	on public.planner_events (user_id, event_date, event_time);

create or replace function public.set_planner_events_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = timezone('utc', now());
	return new;
end;
$$;

drop trigger if exists planner_events_set_updated_at on public.planner_events;

create trigger planner_events_set_updated_at
before update on public.planner_events
for each row
execute function public.set_planner_events_updated_at();

alter table public.planner_events enable row level security;

drop policy if exists "planner_events_select_all" on public.planner_events;
create policy "planner_events_select_all"
on public.planner_events
for select
to anon, authenticated
using (true);

drop policy if exists "planner_events_insert_all" on public.planner_events;
create policy "planner_events_insert_all"
on public.planner_events
for insert
to anon, authenticated
with check (true);

drop policy if exists "planner_events_update_all" on public.planner_events;
create policy "planner_events_update_all"
on public.planner_events
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "planner_events_delete_all" on public.planner_events;
create policy "planner_events_delete_all"
on public.planner_events
for delete
to anon, authenticated
using (true);
