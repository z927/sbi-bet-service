export const PROVIDERS = ["diretta", "api_football"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const MAPPING_STATUSES = ["confirmed", "pending", "rejected"] as const;
export type MappingStatus = (typeof MAPPING_STATUSES)[number];

export const MAPPING_SOURCES = ["manual", "id", "alias", "fuzzy"] as const;
export type MappingSource = (typeof MAPPING_SOURCES)[number];

export type ResolveStatus = "matched" | "pending" | "unmatched" | "rejected";

export interface Team {
  id: string;
  name: string;
  country: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamAlias {
  id: string;
  teamId: string;
  alias: string;
  normalized: string;
  source: string;
  createdAt: string;
}

export interface TeamProviderMapping {
  id: string;
  teamId: string;
  provider: Provider;
  providerTeamId: string;
  rawName: string;
  country: string | null;
  confidence: number;
  status: MappingStatus;
  source: MappingSource;
  createdAt: string;
  updatedAt: string;
}

export interface LeagueLink {
  id: string;
  apiFootballLeagueId: number;
  direttaTournamentId: string | null;
  name: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FixtureLink {
  id: string;
  matchDate: string;
  homeTeamId: string;
  awayTeamId: string;
  direttaMatchId: string | null;
  apiFootballFixtureId: string | null;
  kickoffAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamCandidate {
  team: Team;
  confidence: number;
}

export interface ResolveTeamInput {
  provider: Provider;
  providerTeamId?: string;
  name?: string;
  country?: string;
  autoLink?: boolean;
}

export interface ResolveTeamResult {
  status: ResolveStatus;
  team: Team | null;
  mapping: TeamProviderMapping | null;
  confidence: number;
  candidates: TeamCandidate[];
}

export interface CreateTeamInput {
  name: string;
  country?: string | null;
  aliases?: string[];
}

export interface UpsertMappingInput {
  teamId: string;
  provider: Provider;
  providerTeamId: string;
  rawName?: string;
  country?: string | null;
  confidence?: number;
  status?: MappingStatus;
  source?: MappingSource;
}

export interface UpsertFixtureLinkInput {
  matchDate: string;
  homeTeamId: string;
  awayTeamId: string;
  direttaMatchId?: string | null;
  apiFootballFixtureId?: string | null;
  kickoffAt?: string | null;
}

export interface TeamWithAliases {
  team: Team;
  aliases: string[];
}

export interface UpsertLeagueLinkInput {
  apiFootballLeagueId: number;
  direttaTournamentId?: string | null;
  name?: string | null;
}

export interface SyncSeasonInput {
  leagueId: number;
  season?: number;
  direttaTournamentId?: string;
  dryRun?: boolean;
  maxFixtures?: number;
}

export interface SyncSeasonReport {
  league: {
    apiFootballId: number;
    name: string;
    country: string;
    season: number;
    seasonStart: string;
    seasonEnd: string;
    current: boolean;
  };
  dryRun: boolean;
  teams: { seen: number; created: number; mapped: number };
  fixtures: { seen: number; created: number; updated: number; skipped: number };
  errors: string[];
}
