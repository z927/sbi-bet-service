import { getSettings } from "../../config.ts";

export class ApiFootballError extends Error {
  override readonly name = "ApiFootballError";
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

export interface AfLeagueRef {
  id: number;
  name: string;
  type?: string;
}

export interface AfCountry {
  name: string;
  code?: string | null;
}

export interface AfSeason {
  year: number;
  start: string;
  end: string;
  current: boolean;
}

export interface AfLeague {
  league: AfLeagueRef;
  country: AfCountry;
  seasons: AfSeason[];
}

export interface AfTeam {
  id: number;
  name: string;
  code?: string | null;
  country?: string | null;
  logo?: string | null;
}

export interface AfTeamEntry {
  team: AfTeam;
}

export interface AfFixtureEntry {
  fixture: {
    id: number;
    date: string;
    timestamp?: number;
    timezone?: string;
    status?: { short?: string; long?: string };
  };
  league: { id: number; season: number; round?: string };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals?: { home: number | null; away: number | null };
}

interface AfEnvelope<T> {
  get?: string;
  parameters?: Record<string, unknown>;
  errors?: unknown;
  results?: number;
  paging?: { current: number; total: number };
  response?: T[];
}

const asQuery = (params: Record<string, string | number | boolean | undefined>): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  return query.toString();
};

const hasErrors = (errors: unknown): boolean => {
  if (Array.isArray(errors)) return errors.length > 0;
  if (errors !== null && typeof errors === "object") return Object.keys(errors).length > 0;
  return false;
};

const request = async <T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<AfEnvelope<T>> => {
  const settings = getSettings();
  if (settings.apiFootballKey === "") {
    throw new ApiFootballError("API_FOOTBALL_KEY must be set");
  }
  const query = asQuery(params);
  const url = `${settings.apiFootballBaseUrl.replace(/\/$/, "")}${path}${query === "" ? "" : `?${query}`}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "x-apisports-key": settings.apiFootballKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    throw new ApiFootballError(`Errore di rete API-Football: ${message}`);
  }
  const text = await response.text();
  let body: AfEnvelope<T>;
  try {
    body = JSON.parse(text) as AfEnvelope<T>;
  } catch {
    throw new ApiFootballError(`Risposta API-Football non valida (HTTP ${response.status})`, response.status);
  }
  if (!response.ok) {
    throw new ApiFootballError(`HTTP ${response.status} da API-Football`, response.status);
  }
  if (hasErrors(body.errors)) {
    throw new ApiFootballError(`API-Football: ${JSON.stringify(body.errors)}`, response.status);
  }
  return body;
};

const fetchAll = async <T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  maxPages = 100,
): Promise<T[]> => {
  const all: T[] = [];
  let page = 1;
  while (page <= maxPages) {
    const body = await request<T>(path, { ...params, page });
    all.push(...(body.response ?? []));
    const total = body.paging?.total ?? 1;
    if (page >= total) {
      break;
    }
    page += 1;
  }
  return all;
};

export const getLeague = async (leagueId: number): Promise<AfLeague> => {
  const body = await request<AfLeague>("/leagues", { id: leagueId });
  const league = (body.response ?? [])[0];
  if (!league) {
    throw new ApiFootballError(`Lega API-Football non trovata: ${leagueId}`);
  }
  return league;
};

export const resolveSeason = (league: AfLeague, requested?: number): AfSeason => {
  const seasons = league.seasons ?? [];
  if (requested !== undefined) {
    const found = seasons.find((season) => season.year === requested);
    if (!found) {
      throw new ApiFootballError(`Stagione ${requested} non disponibile per la lega ${league.league.id}`);
    }
    return found;
  }
  const current = seasons.find((season) => season.current);
  if (!current) {
    throw new ApiFootballError(`Nessuna current season per la lega ${league.league.id}`);
  }
  return current;
};

export const listTeams = async (leagueId: number, season: number): Promise<AfTeamEntry[]> => {
  return fetchAll<AfTeamEntry>("/teams", { league: leagueId, season });
};

export const listFixtures = async (leagueId: number, season: number): Promise<AfFixtureEntry[]> => {
  return fetchAll<AfFixtureEntry>("/fixtures", { league: leagueId, season });
};

export const listLeagues = async (params: {
  search?: string;
  country?: string;
  code?: string;
} = {}): Promise<AfLeague[]> => {
  const body = await request<AfLeague>("/leagues", {
    search: params.search,
    country: params.country,
    code: params.code,
  });
  return body.response ?? [];
};
