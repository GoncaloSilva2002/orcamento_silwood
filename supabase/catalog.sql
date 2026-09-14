-- Run once in the Supabase SQL Editor before npm run migrate:supabase.
-- The old app_catalog table can stay as a backup, but the application now reads
-- the catalogue from one table per material/category.

create table if not exists public.app_catalog_meta (
  id text primary key check (id = 'main'),
  lists jsonb not null check (jsonb_typeof(lists) = 'object'),
  type_presets jsonb not null check (jsonb_typeof(type_presets) = 'object'),
  feet_prices jsonb not null check (jsonb_typeof(feet_prices) = 'object'),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_plates (
  item_key text primary key,
  item_order integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

create table if not exists public.catalog_paintings (
  item_key text primary key,
  item_order integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

create table if not exists public.catalog_door_systems (
  item_key text primary key,
  item_order integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

create table if not exists public.catalog_hinges (
  item_key text primary key,
  item_order integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

create table if not exists public.catalog_hinge_components (
  item_key text primary key,
  item_order integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

create table if not exists public.catalog_opening_system_components (
  item_key text primary key,
  item_order integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

create table if not exists public.catalog_edges (
  item_key text primary key,
  item_order integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

create table if not exists public.catalog_extras (
  item_key text primary key,
  item_order integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

create table if not exists public.catalog_painting_components (
  item_key text primary key,
  item_order integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

create table if not exists public.catalog_painting_mix_details (
  item_key text primary key,
  item_order integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

create table if not exists public.catalog_paint_recipes (
  item_key text primary key,
  item_order integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

create table if not exists public.catalog_drawer_components (
  item_key text primary key,
  item_order integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

create table if not exists public.catalog_drawer_recipes (
  item_key text primary key,
  item_order integer not null,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

alter table public.app_catalog_meta enable row level security;
alter table public.catalog_plates enable row level security;
alter table public.catalog_paintings enable row level security;
alter table public.catalog_door_systems enable row level security;
alter table public.catalog_hinges enable row level security;
alter table public.catalog_hinge_components enable row level security;
alter table public.catalog_opening_system_components enable row level security;
alter table public.catalog_edges enable row level security;
alter table public.catalog_extras enable row level security;
alter table public.catalog_painting_components enable row level security;
alter table public.catalog_painting_mix_details enable row level security;
alter table public.catalog_paint_recipes enable row level security;
alter table public.catalog_drawer_components enable row level security;
alter table public.catalog_drawer_recipes enable row level security;

revoke all on public.app_catalog_meta from anon, authenticated;
revoke all on public.catalog_plates from anon, authenticated;
revoke all on public.catalog_paintings from anon, authenticated;
revoke all on public.catalog_door_systems from anon, authenticated;
revoke all on public.catalog_hinges from anon, authenticated;
revoke all on public.catalog_hinge_components from anon, authenticated;
revoke all on public.catalog_opening_system_components from anon, authenticated;
revoke all on public.catalog_edges from anon, authenticated;
revoke all on public.catalog_extras from anon, authenticated;
revoke all on public.catalog_painting_components from anon, authenticated;
revoke all on public.catalog_painting_mix_details from anon, authenticated;
revoke all on public.catalog_paint_recipes from anon, authenticated;
revoke all on public.catalog_drawer_components from anon, authenticated;
revoke all on public.catalog_drawer_recipes from anon, authenticated;

grant select, insert, update, delete on public.app_catalog_meta to service_role;
grant select, insert, update, delete on public.catalog_plates to service_role;
grant select, insert, update, delete on public.catalog_paintings to service_role;
grant select, insert, update, delete on public.catalog_door_systems to service_role;
grant select, insert, update, delete on public.catalog_hinges to service_role;
grant select, insert, update, delete on public.catalog_hinge_components to service_role;
grant select, insert, update, delete on public.catalog_opening_system_components to service_role;
grant select, insert, update, delete on public.catalog_edges to service_role;
grant select, insert, update, delete on public.catalog_extras to service_role;
grant select, insert, update, delete on public.catalog_painting_components to service_role;
grant select, insert, update, delete on public.catalog_painting_mix_details to service_role;
grant select, insert, update, delete on public.catalog_paint_recipes to service_role;
grant select, insert, update, delete on public.catalog_drawer_components to service_role;
grant select, insert, update, delete on public.catalog_drawer_recipes to service_role;

-- Access is exclusively through the server. Existing admin checks protect writes.
