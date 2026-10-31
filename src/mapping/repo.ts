import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSettings } from "../config.ts";
import { normalizeTeamName } from "./normalize.ts";
import type {
  FixtureLink,
  LeagueLink,
  MappingSource,
  MappingStatus,
  Provider,
  Team,
  TeamAlias,
  TeamProviderMapping,
  TeamWithAliases,
  UpsertFixtureLinkInput,
  UpsertLeagueLinkInput,
  UpsertMappingInput,
} from "./models.ts";

interface TeamRow {
  id: string;
  name: string;
  country: string | null;
  created_at: string;
  updated_at: string;
}

interface AliasRow {
  id: string;
  team_id: string;
  alias: string;
  normalized: string;
  source: string;
  created_at: string;
}

interface MappingRow {
  id: string;
  team_id: string;
  provider: Provider;
  provider_team_id: string;
  raw_name: string;
  country: string | null;
  confidence: number | string;
  status: MappingStatus;
  source: MappingSource;
  created_at: string;
  updated_at: string;
}

interface FixtureRow {
  id: string;
  match_date: string;
  home_team_id: string;
  away_team_id: string;
  diretta_match_id: string | null;
  api_football_fixture_id: string | null;
  kickoff_at: string | null;
  created_at: string;
  updated_at: string;
}

interface LeagueRow {
  id: string;
  api_football_league_id: number | string;
  diretta_tournament_id: string | null;
  name: string | null;
  created_at: string;
  updated_at: string;
}

let client: SupabaseClient | null = null;
let useMemory = false;

const memory = {
  teams: new Map<string, Team>(),
  aliases: new Map<string, TeamAlias>(),
  mappings: new Map<string, TeamProviderMapping>(),
  fixtures: new Map<string, FixtureLink>(),
  leagues: new Map<string, LeagueLink>(),
};

const getClient = (): SupabaseClient => {
  if (client) {
    return client;
  }
  const settings = getSettings();
  if (!settings.supabaseUrl || !settings.supabaseServiceRoleKey) {
    useMemory = true;
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  client = createClient(settings.supabaseUrl, settings.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
};

const isMemoryMode = (): boolean => {
  if (useMemory) return true;
  const settings = getSettings();
  if (!settings.supabaseUrl || !settings.supabaseServiceRoleKey) {
    useMemory = true;
    return true;
  }
  return false;
};

const nowIso = (): string => new Date().toISOString();

const aliasKey = (teamId: string, normalized: string): string => `${teamId}:${normalized}`;
const mappingKey = (provider: Provider, providerTeamId: string): string => `${provider}:${providerTeamId}`;
const fixtureKey = (matchDate: string, homeTeamId: string, awayTeamId: string): string =>
  `${matchDate}:${homeTeamId}:${awayTeamId}`;

const toTeam = (row: TeamRow): Team => ({
  id: row.id,
  name: row.name,
  country: row.country,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toAlias = (row: AliasRow): TeamAlias => ({
  id: row.id,
  teamId: row.team_id,
  alias: row.alias,
  normalized: row.normalized,
  source: row.source,
  createdAt: row.created_at,
});

const toMapping = (row: MappingRow): TeamProviderMapping => ({
  id: row.id,
  teamId: row.team_id,
  provider: row.provider,
  providerTeamId: row.provider_team_id,
  rawName: row.raw_name,
  country: row.country,
  confidence: typeof row.confidence === "number" ? row.confidence : Number.parseFloat(row.confidence),
  status: row.status,
  source: row.source,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toLeague = (row: LeagueRow): LeagueLink => ({
  id: row.id,
  apiFootballLeagueId:
    typeof row.api_football_league_id === "number"
      ? row.api_football_league_id
      : Number.parseInt(row.api_football_league_id, 10),
  direttaTournamentId: row.diretta_tournament_id,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toFixture = (row: FixtureRow): FixtureLink => ({
  id: row.id,
  matchDate: row.match_date,
  homeTeamId: row.home_team_id,
  awayTeamId: row.away_team_id,
  direttaMatchId: row.diretta_match_id,
  apiFootballFixtureId: row.api_football_fixture_id,
  kickoffAt: row.kickoff_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const resetMappingStore = (): void => {
  memory.teams.clear();
  memory.aliases.clear();
  memory.mappings.clear();
  memory.fixtures.clear();
  memory.leagues.clear();
};

export const listTeams = async (): Promise<Team[]> => {
  if (isMemoryMode()) {
    return [...memory.teams.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  const { data, error } = await getClient().from("teams").select("*").order("name");
  if (error) throw error;
  return ((data ?? []) as TeamRow[]).map(toTeam);
};

export const getTeam = async (teamId: string): Promise<Team | null> => {
  if (isMemoryMode()) {
    return memory.teams.get(teamId) ?? null;
  }
  const { data, error } = await getClient().from("teams").select("*").eq("id", teamId).maybeSingle();
  if (error) throw error;
  return data ? toTeam(data as TeamRow) : null;
};

export const getTeamsByIds = async (teamIds: string[]): Promise<Team[]> => {
  if (teamIds.length === 0) return [];
  if (isMemoryMode()) {
    return teamIds.map((id) => memory.teams.get(id)).filter((team): team is Team => team !== undefined);
  }
  const { data, error } = await getClient().from("teams").select("*").in("id", teamIds);
  if (error) throw error;
  return ((data ?? []) as TeamRow[]).map(toTeam);
};

export const createTeam = async (name: string, country: string | null): Promise<Team> => {
  if (isMemoryMode()) {
    const timestamp = nowIso();
    const team: Team = { id: randomUUID(), name, country, createdAt: timestamp, updatedAt: timestamp };
    memory.teams.set(team.id, team);
    return team;
  }
  const { data, error } = await getClient().from("teams").insert({ name, country }).select("*").single();
  if (error) throw error;
  return toTeam(data as TeamRow);
};

export const addAlias = async (
  teamId: string,
  alias: string,
  source: string = "manual",
): Promise<TeamAlias> => {
  const normalized = normalizeTeamName(alias);
  if (isMemoryMode()) {
    const key = aliasKey(teamId, normalized);
    const existing = memory.aliases.get(key);
    if (existing) return existing;
    const entry: TeamAlias = {
      id: randomUUID(),
      teamId,
      alias,
      normalized,
      source,
      createdAt: nowIso(),
    };
    memory.aliases.set(key, entry);
    return entry;
  }
  const { data, error } = await getClient()
    .from("team_aliases")
    .upsert(
      { team_id: teamId, alias, normalized, source },
      { onConflict: "team_id,normalized", ignoreDuplicates: true },
    )
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (data) return toAlias(data as AliasRow);
  const existing = await getClient()
    .from("team_aliases")
    .select("*")
    .eq("team_id", teamId)
    .eq("normalized", normalized)
    .single();
  if (existing.error) throw existing.error;
  return toAlias(existing.data as AliasRow);
};

export const listAliases = async (teamId: string): Promise<TeamAlias[]> => {
  if (isMemoryMode()) {
    return [...memory.aliases.values()].filter((entry) => entry.teamId === teamId);
  }
  const { data, error } = await getClient().from("team_aliases").select("*").eq("team_id", teamId);
  if (error) throw error;
  return ((data ?? []) as AliasRow[]).map(toAlias);
};

export const findTeamsByNormalizedAlias = async (normalized: string): Promise<Team[]> => {
  if (normalized === "") return [];
  if (isMemoryMode()) {
    const teamIds = new Set(
      [...memory.aliases.values()].filter((entry) => entry.normalized === normalized).map((entry) => entry.teamId),
    );
    return [...teamIds]
      .map((id) => memory.teams.get(id))
      .filter((team): team is Team => team !== undefined);
  }
  const { data, error } = await getClient().from("team_aliases").select("team_id").eq("normalized", normalized);
  if (error) throw error;
  const teamIds = [...new Set(((data ?? []) as Array<{ team_id: string }>).map((row) => row.team_id))];
  return getTeamsByIds(teamIds);
};

export const listTeamsWithAliases = async (): Promise<TeamWithAliases[]> => {
  const teams = await listTeams();
  if (isMemoryMode()) {
    return teams.map((team) => ({
      team,
      aliases: [...memory.aliases.values()]
        .filter((entry) => entry.teamId === team.id)
        .map((entry) => entry.alias),
    }));
  }
  const { data, error } = await getClient().from("team_aliases").select("team_id,alias");
  if (error) throw error;
  const grouped = new Map<string, string[]>();
  for (const row of (data ?? []) as Array<{ team_id: string; alias: string }>) {
    const list = grouped.get(row.team_id) ?? [];
    list.push(row.alias);
    grouped.set(row.team_id, list);
  }
  return teams.map((team) => ({ team, aliases: grouped.get(team.id) ?? [] }));
};

export const findMapping = async (
  provider: Provider,
  providerTeamId: string,
): Promise<TeamProviderMapping | null> => {
  if (isMemoryMode()) {
    return memory.mappings.get(mappingKey(provider, providerTeamId)) ?? null;
  }
  const { data, error } = await getClient()
    .from("team_provider_mappings")
    .select("*")
    .eq("provider", provider)
    .eq("provider_team_id", providerTeamId)
    .maybeSingle();
  if (error) throw error;
  return data ? toMapping(data as MappingRow) : null;
};

export const getMapping = async (mappingId: string): Promise<TeamProviderMapping | null> => {
  if (isMemoryMode()) {
    return [...memory.mappings.values()].find((mapping) => mapping.id === mappingId) ?? null;
  }
  const { data, error } = await getClient()
    .from("team_provider_mappings")
    .select("*")
    .eq("id", mappingId)
    .maybeSingle();
  if (error) throw error;
  return data ? toMapping(data as MappingRow) : null;
};

export const listMappings = async (status?: MappingStatus): Promise<TeamProviderMapping[]> => {
  if (isMemoryMode()) {
    return [...memory.mappings.values()]
      .filter((mapping) => status === undefined || mapping.status === status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  let query = getClient().from("team_provider_mappings").select("*").order("created_at");
  if (status !== undefined) {
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as MappingRow[]).map(toMapping);
};

export const upsertMapping = async (input: UpsertMappingInput): Promise<TeamProviderMapping> => {
  const values = {
    team_id: input.teamId,
    provider: input.provider,
    provider_team_id: input.providerTeamId,
    raw_name: input.rawName ?? "",
    country: input.country ?? null,
    confidence: input.confidence ?? 1,
    status: input.status ?? "confirmed",
    source: input.source ?? "manual",
  };
  if (isMemoryMode()) {
    const key = mappingKey(input.provider, input.providerTeamId);
    const existing = memory.mappings.get(key);
    const timestamp = nowIso();
    const mapping: TeamProviderMapping = {
      id: existing?.id ?? randomUUID(),
      teamId: input.teamId,
      provider: input.provider,
      providerTeamId: input.providerTeamId,
      rawName: values.raw_name,
      country: values.country,
      confidence: values.confidence,
      status: values.status,
      source: values.source,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    memory.mappings.set(key, mapping);
    return mapping;
  }
  const { data, error } = await getClient()
    .from("team_provider_mappings")
    .upsert(values, { onConflict: "provider,provider_team_id" })
    .select("*")
    .single();
  if (error) throw error;
  return toMapping(data as MappingRow);
};

export const setMappingStatus = async (
  mappingId: string,
  status: MappingStatus,
): Promise<TeamProviderMapping | null> => {
  if (isMemoryMode()) {
    const entry = [...memory.mappings.entries()].find(([, mapping]) => mapping.id === mappingId);
    if (!entry) return null;
    const [key, mapping] = entry;
    const updated: TeamProviderMapping = { ...mapping, status, updatedAt: nowIso() };
    memory.mappings.set(key, updated);
    return updated;
  }
  const { data, error } = await getClient()
    .from("team_provider_mappings")
    .update({ status })
    .eq("id", mappingId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ? toMapping(data as MappingRow) : null;
};

export const upsertFixtureLink = async (input: UpsertFixtureLinkInput): Promise<FixtureLink> => {
  const values: Record<string, unknown> = {
    match_date: input.matchDate,
    home_team_id: input.homeTeamId,
    away_team_id: input.awayTeamId,
  };
  if (input.direttaMatchId !== undefined) values["diretta_match_id"] = input.direttaMatchId;
  if (input.apiFootballFixtureId !== undefined) values["api_football_fixture_id"] = input.apiFootballFixtureId;
  if (input.kickoffAt !== undefined) values["kickoff_at"] = input.kickoffAt;
  if (isMemoryMode()) {
    const key = fixtureKey(input.matchDate, input.homeTeamId, input.awayTeamId);
    const existing = memory.fixtures.get(key);
    const timestamp = nowIso();
    const fixture: FixtureLink = {
      id: existing?.id ?? randomUUID(),
      matchDate: input.matchDate,
      homeTeamId: input.homeTeamId,
      awayTeamId: input.awayTeamId,
      direttaMatchId:
        input.direttaMatchId !== undefined ? input.direttaMatchId : (existing?.direttaMatchId ?? null),
      apiFootballFixtureId:
        input.apiFootballFixtureId !== undefined
          ? input.apiFootballFixtureId
          : (existing?.apiFootballFixtureId ?? null),
      kickoffAt: input.kickoffAt !== undefined ? input.kickoffAt : (existing?.kickoffAt ?? null),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    memory.fixtures.set(key, fixture);
    return fixture;
  }
  const { data, error } = await getClient()
    .from("fixture_links")
    .upsert(values, { onConflict: "match_date,home_team_id,away_team_id" })
    .select("*")
    .single();
  if (error) throw error;
  return toFixture(data as FixtureRow);
};

export const getFixtureLink = async (
  matchDate: string,
  homeTeamId: string,
  awayTeamId: string,
): Promise<FixtureLink | null> => {
  if (isMemoryMode()) {
    return memory.fixtures.get(fixtureKey(matchDate, homeTeamId, awayTeamId)) ?? null;
  }
  const { data, error } = await getClient()
    .from("fixture_links")
    .select("*")
    .eq("match_date", matchDate)
    .eq("home_team_id", homeTeamId)
    .eq("away_team_id", awayTeamId)
    .maybeSingle();
  if (error) throw error;
  return data ? toFixture(data as FixtureRow) : null;
};

export const getFixtureLinkByApiFootballId = async (fixtureId: string): Promise<FixtureLink | null> => {
  if (isMemoryMode()) {
    return (
      [...memory.fixtures.values()].find((fixture) => fixture.apiFootballFixtureId === fixtureId) ?? null
    );
  }
  const { data, error } = await getClient()
    .from("fixture_links")
    .select("*")
    .eq("api_football_fixture_id", fixtureId)
    .maybeSingle();
  if (error) throw error;
  return data ? toFixture(data as FixtureRow) : null;
};

export const getLeagueLink = async (apiFootballLeagueId: number): Promise<LeagueLink | null> => {
  if (isMemoryMode()) {
    return memory.leagues.get(String(apiFootballLeagueId)) ?? null;
  }
  const { data, error } = await getClient()
    .from("league_links")
    .select("*")
    .eq("api_football_league_id", apiFootballLeagueId)
    .maybeSingle();
  if (error) throw error;
  return data ? toLeague(data as LeagueRow) : null;
};

export const upsertLeagueLink = async (input: UpsertLeagueLinkInput): Promise<LeagueLink> => {
  const values: Record<string, unknown> = { api_football_league_id: input.apiFootballLeagueId };
  if (input.direttaTournamentId !== undefined) values["diretta_tournament_id"] = input.direttaTournamentId;
  if (input.name !== undefined) values["name"] = input.name;
  if (isMemoryMode()) {
    const key = String(input.apiFootballLeagueId);
    const existing = memory.leagues.get(key);
    const timestamp = nowIso();
    const link: LeagueLink = {
      id: existing?.id ?? randomUUID(),
      apiFootballLeagueId: input.apiFootballLeagueId,
      direttaTournamentId:
        input.direttaTournamentId !== undefined
          ? input.direttaTournamentId
          : (existing?.direttaTournamentId ?? null),
      name: input.name !== undefined ? input.name : (existing?.name ?? null),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    memory.leagues.set(key, link);
    return link;
  }
  const { data, error } = await getClient()
    .from("league_links")
    .upsert(values, { onConflict: "api_football_league_id" })
    .select("*")
    .single();
  if (error) throw error;
  return toLeague(data as LeagueRow);
};
