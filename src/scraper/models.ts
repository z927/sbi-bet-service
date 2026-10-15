export interface Match {
  id: string;
  sport?: number;
  tournament?: string;
  country?: string;
  tournament_id?: string;
  league_url?: string;
  home?: string;
  away?: string;
  home_short?: string;
  away_short?: string;
  home_score?: number | null;
  away_score?: number | null;
  home_id?: string;
  away_id?: string;
  home_logo?: string | null;
  away_logo?: string | null;
  status?: string;
  status_code?: number | null;
  stage_id?: number | null;
  stage_start?: number | null;
  is_live?: boolean;
  minute?: string | null;
  start_time?: number | null;
  statistics?: { groups: unknown[] };
  events?: unknown[];
  lineups?: Record<string, unknown>;
  odds?: { bookmakers: string[]; markets: unknown[] };
  detail?: Record<string, unknown>;
  enrich_error?: string;
  [key: string]: unknown;
}

export interface MatchSnapshot {
  match_id: string;
  home_score: number | null;
  away_score: number | null;
  status_code: number | null;
  stage_id: number | null;
  minute: string | null;
  captured_at: string;
}

export interface MatchesResponse {
  count: number;
  cached: boolean;
  matches: Match[];
}

export interface HealthResponse {
  status: string;
  db: string;
  matches_stored: number;
}

export interface ScrapeTestResponse {
  ok: boolean;
  sport: number;
  scope: string;
  feed: string;
  elapsed_ms: number;
  matches_parsed: number;
  live_matches: number;
  stored: number;
  sample: Match[];
  error: string | null;
}
