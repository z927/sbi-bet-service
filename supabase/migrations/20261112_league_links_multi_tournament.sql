-- Allow multiple Diretta tournament IDs per API-Football league.
-- A single league (e.g. UEFA Nations League) may map to several Diretta
-- tournament ids (League A, B, C, D), so the unique constraint moves from
-- api_football_league_id alone to the composite (api_football_league_id, diretta_tournament_id).
alter table public.league_links drop constraint league_links_api_football_league_id_key;

create unique index if not exists league_links_api_football_league_id_diretta_tournament_id_key
  on public.league_links (api_football_league_id, diretta_tournament_id)
  where diretta_tournament_id is not null;
