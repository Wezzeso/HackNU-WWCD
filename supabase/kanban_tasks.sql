create extension if not exists pgcrypto;

create table if not exists public.kanban_tasks (
	id uuid primary key default gen_random_uuid(),
	room_id text not null,
	title text not null,
	description text,
	status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
	priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
	task_code text not null default ('HN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
	due_label text,
	comments_count integer not null default 0 check (comments_count >= 0),
	sort_order integer not null default 0,
	created_by text not null,
	created_by_name text,
	created_by_color text,
	created_at timestamptz not null default timezone('utc', now()),
	updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists kanban_tasks_room_status_sort_idx
	on public.kanban_tasks (room_id, status, sort_order, created_at);

create or replace function public.set_kanban_tasks_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = timezone('utc', now());
	return new;
end;
$$;

drop trigger if exists kanban_tasks_set_updated_at on public.kanban_tasks;

create trigger kanban_tasks_set_updated_at
before update on public.kanban_tasks
for each row
execute function public.set_kanban_tasks_updated_at();

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.kanban_tasks to anon, authenticated;

alter table public.kanban_tasks enable row level security;

drop policy if exists "kanban_tasks_select_all" on public.kanban_tasks;
create policy "kanban_tasks_select_all"
on public.kanban_tasks
for select
to anon, authenticated
using (true);

drop policy if exists "kanban_tasks_insert_all" on public.kanban_tasks;
create policy "kanban_tasks_insert_all"
on public.kanban_tasks
for insert
to anon, authenticated
with check (true);

drop policy if exists "kanban_tasks_update_all" on public.kanban_tasks;
create policy "kanban_tasks_update_all"
on public.kanban_tasks
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "kanban_tasks_delete_all" on public.kanban_tasks;
create policy "kanban_tasks_delete_all"
on public.kanban_tasks
for delete
to anon, authenticated
using (true);
