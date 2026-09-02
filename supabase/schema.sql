create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  role text not null default 'guest' check (role in ('admin', 'reseller', 'guest')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles alter column role set default 'guest';
update public.profiles set role = 'guest' where role = 'user';
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'reseller', 'guest'));

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'guest',
    true
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create table if not exists public.quote_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  snapshot_key text not null,
  label text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, snapshot_key)
);

alter table public.quote_history enable row level security;

drop policy if exists "quote_history_select_own" on public.quote_history;
create policy "quote_history_select_own"
  on public.quote_history
  for select
  using (auth.uid() = owner_id);

drop policy if exists "quote_history_insert_own" on public.quote_history;
create policy "quote_history_insert_own"
  on public.quote_history
  for insert
  with check (auth.uid() = owner_id);

drop policy if exists "quote_history_update_own" on public.quote_history;
create policy "quote_history_update_own"
  on public.quote_history
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "quote_history_delete_own" on public.quote_history;
create policy "quote_history_delete_own"
  on public.quote_history
  for delete
  using (auth.uid() = owner_id);
