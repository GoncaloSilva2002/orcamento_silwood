-- Run once in the Supabase SQL Editor before npm run migrate:supabase.
-- A versioned document preserves the existing catalogue categories and recipes
-- together, allowing atomic price updates without partially updated recipes.
create table if not exists public.app_catalog (
  id text primary key check (id = 'main'),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.app_catalog enable row level security;
revoke all on public.app_catalog from anon, authenticated;
grant select, insert, update on public.app_catalog to service_role;
-- Access is exclusively through the server. Existing admin checks protect writes.
