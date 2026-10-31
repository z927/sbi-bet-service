-- Team identity mapping between diretta.it and API-Football.
-- Canonical teams are provider-agnostic; provider ids live in a separate table.
-- Fixture links tie a canonical fixture to the provider-specific match ids.

create extension if not exists pgcrypto;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists teams_name_country_key
  on public.teams (lower(name), coalesce(lower(country), ''));

create table if not exists public.team_provider_mappings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  provider text not null check (provider in ('diretta', 'api_football')),
  provider_team_id text not null,
  raw_name text not null,
  country text,
  confidence numeric(4, 3) not null default 1 check (confidence >= 0 and confidence <= 1),
  status text not null default 'confirmed' check (status in ('confirmed', 'pending', 'rejected')),
  source text not null default 'manual' check (source in ('manual', 'id', 'alias', 'fuzzy')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_team_id)
);

create index if not exists team_provider_mappings_team_id_idx
  on public.team_provider_mappings (team_id);
create index if not exists team_provider_mappings_status_idx
  on public.team_provider_mappings (status);

create table if not exists public.team_aliases (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  alias text not null,
  normalized text not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (team_id, normalized)
);

create index if not exists team_aliases_normalized_idx
  on public.team_aliases (normalized);

create table if not exists public.fixture_links (
  id uuid primary key default gen_random_uuid(),
  match_date date not null,
  home_team_id uuid not null references public.teams (id) on delete cascade,
  away_team_id uuid not null references public.teams (id) on delete cascade,
  diretta_match_id text,
  api_football_fixture_id text,
  kickoff_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_date, home_team_id, away_team_id)
);

create unique index if not exists fixture_links_diretta_match_id_key
  on public.fixture_links (diretta_match_id)
  where diretta_match_id is not null;
create unique index if not exists fixture_links_api_football_fixture_id_key
  on public.fixture_links (api_football_fixture_id)
  where api_football_fixture_id is not null;

create table if not exists public.league_links (
  id uuid primary key default gen_random_uuid(),
  api_football_league_id bigint not null unique,
  diretta_tournament_id text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists league_links_diretta_tournament_id_key
  on public.league_links (diretta_tournament_id)
  where diretta_tournament_id is not null;

create or replace function public.team_mapping_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists teams_set_updated_at on public.teams;
create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function public.team_mapping_set_updated_at();

drop trigger if exists team_provider_mappings_set_updated_at on public.team_provider_mappings;
create trigger team_provider_mappings_set_updated_at
  before update on public.team_provider_mappings
  for each row execute function public.team_mapping_set_updated_at();

drop trigger if exists fixture_links_set_updated_at on public.fixture_links;
create trigger fixture_links_set_updated_at
  before update on public.fixture_links
  for each row execute function public.team_mapping_set_updated_at();

drop trigger if exists league_links_set_updated_at on public.league_links;
create trigger league_links_set_updated_at
  before update on public.league_links
  for each row execute function public.team_mapping_set_updated_at();

-- The service uses the service role key, which bypasses RLS. No public policies
-- are created on purpose: these tables are internal.
alter table public.teams enable row level security;
alter table public.team_provider_mappings enable row level security;
alter table public.team_aliases enable row level security;
alter table public.fixture_links enable row level security;
alter table public.league_links enable row level security;
