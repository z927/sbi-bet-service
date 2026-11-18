-- Replace the partial unique index on league_links with a full unique
-- constraint so that ON CONFLICT can target
-- (api_football_league_id, diretta_tournament_id).
--
-- The previous index had a WHERE diretta_tournament_id IS NOT NULL clause,
-- which PostgreSQL cannot use as an ON CONFLICT arbiter (error 42P10).
-- A full UNIQUE constraint treats NULL as distinct, so multiple rows with
-- the same league and a NULL diretta_tournament_id remain allowed.
drop index if exists public.league_links_api_football_league_id_diretta_tournament_id_key;

create unique index if not exists league_links_api_football_league_id_diretta_tournament_id_key
  on public.league_links (api_football_league_id, diretta_tournament_id);
