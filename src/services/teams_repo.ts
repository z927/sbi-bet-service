import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSettings } from "../config.ts";

export interface Team {
  id: string;
  diretta_name: string;
  api_football_id: number | null;
  api_football_name: string | null;
  api_football_league_id: number | null;
  country: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamInput {
  diretta_name: string;
  api_football_id: number | null;
  api_football_name: string | null;
  api_football_league_id: number | null;
  country: string | null;
}

let client: SupabaseClient | null = null;
let useMemory = false;
const memoryTeams = new Map<string, Team>();

const getClient = (): SupabaseClient => {
  if (client) {
    return client;
  }
  try {
    const settings = getSettings();
    const url = settings.supabaseUrl;
    const key = settings.supabaseServiceRoleKey;
    if (!url || !key) {
      useMemory = true;
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    client = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    return client;
  } catch {
    useMemory = true;
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
};

const isMemoryMode = (): boolean => {
  if (useMemory) return true;
  try {
    const settings = getSettings();
    if (!settings.supabaseUrl || !settings.supabaseServiceRoleKey) {
      useMemory = true;
      return true;
    }
  } catch {
    useMemory = true;
    return true;
  }
  return false;
};

const nowIso = (): string => new Date().toISOString();

export const initTeamsRepo = (): void => {
  // Tables are managed via Supabase migrations.
};

export const upsertTeams = async (teams: TeamInput[]): Promise<number> => {
  if (teams.length === 0) {
    return 0;
  }
  if (isMemoryMode()) {
    let stored = 0;
    const timestamp = nowIso();
    for (const team of teams) {
      const id = team.diretta_name.toLowerCase().replace(/\s+/g, "_");
      const existing = memoryTeams.get(id);
      memoryTeams.set(id, {
        id,
        ...team,
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
      });
      stored += 1;
    }
    return stored;
  }

  const supabase = getClient();
  const timestamp = nowIso();
  let stored = 0;

  for (const team of teams) {
    const { error: teamError } = await supabase
      .from("teams")
      .upsert(
        {
          id: team.diretta_name.toLowerCase().replace(/\s+/g, "_"),
          diretta_name: team.diretta_name,
          api_football_id: team.api_football_id,
          api_football_name: team.api_football_name,
          api_football_league_id: team.api_football_league_id,
          country: team.country ?? null,
          updated_at: timestamp,
        },
        { onConflict: "id" },
      );
    if (teamError) throw teamError;

    stored += 1;
  }

  return stored;
};

export const getTeams = async (): Promise<Team[]> => {
  if (isMemoryMode()) {
    return Array.from(memoryTeams.values());
  }

  const supabase = getClient();
  const { data, error } = await supabase
    .from("teams")
    .select("id, diretta_name, api_football_id, api_football_name, api_football_league_id, country, created_at, updated_at")
    .order("diretta_name");
  if (error) {
    throw error;
  }
  return ((data ?? []) as Array<{ id: string; diretta_name: string; api_football_id: number | null; api_football_name: string | null; api_football_league_id: number | null; country: string | null; created_at: string; updated_at: string }>).map((row) => ({
    id: row.id,
    diretta_name: row.diretta_name,
    api_football_id: row.api_football_id,
    api_football_name: row.api_football_name,
    api_football_league_id: row.api_football_league_id,
    country: row.country,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
};

export const getTeam = async (direttaName: string): Promise<Team | null> => {
  if (isMemoryMode()) {
    const id = direttaName.toLowerCase().replace(/\s+/g, "_");
    return memoryTeams.get(id) ?? null;
  }

  const supabase = getClient();
  const { data, error } = await supabase
    .from("teams")
    .select("id, diretta_name, api_football_id, api_football_name, api_football_league_id, country, created_at, updated_at")
    .eq("diretta_name", direttaName)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  const row = data as { id: string; diretta_name: string; api_football_id: number | null; api_football_name: string | null; api_football_league_id: number | null; country: string | null; created_at: string; updated_at: string };
  return {
    id: row.id,
    diretta_name: row.diretta_name,
    api_football_id: row.api_football_id,
    api_football_name: row.api_football_name,
    api_football_league_id: row.api_football_league_id,
    country: row.country,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

export const getTeamsByApiFootballLeague = async (apiFootballLeagueId: number): Promise<Team[]> => {
  if (isMemoryMode()) {
    return Array.from(memoryTeams.values()).filter((t) => t.api_football_league_id === apiFootballLeagueId);
  }

  // The new schema stores league links in `league_links`, not on teams, so there
  // is no direct team-to-league join. Return empty rather than guessing.
  return [];
};

export const getTeamByApiFootballId = async (apiFootballId: number): Promise<Team | null> => {
  if (isMemoryMode()) {
    for (const team of memoryTeams.values()) {
      if (team.api_football_id === apiFootballId) {
        return team;
      }
    }
    return null;
  }

  const supabase = getClient();
  const providerTeamId = String(apiFootballId);

  const { data: mapping, error: mappingError } = await supabase
    .from("team_provider_mappings")
    .select("team_id, raw_name, country")
    .eq("provider", "api_football")
    .eq("provider_team_id", providerTeamId)
    .maybeSingle();
  if (mappingError) {
    throw mappingError;
  }
  if (!mapping) {
    return null;
  }

  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("id, diretta_name, api_football_id, api_football_name, api_football_league_id, country, created_at, updated_at")
    .eq("id", (mapping as { team_id: string }).team_id)
    .maybeSingle();
  if (teamError) {
    throw teamError;
  }
  if (!team) {
    return null;
  }

  const row = team as { id: string; diretta_name: string; api_football_id: number | null; api_football_name: string | null; api_football_league_id: number | null; country: string | null; created_at: string; updated_at: string };
  return {
    id: row.id,
    diretta_name: row.diretta_name,
    api_football_id: row.api_football_id ?? apiFootballId,
    api_football_name: row.api_football_name ?? (mapping as { raw_name: string | null }).raw_name ?? row.diretta_name ?? null,
    api_football_league_id: row.api_football_league_id,
    country: row.country ?? (mapping as { country: string | null }).country ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

export const countTeams = async (): Promise<number> => {
  if (isMemoryMode()) {
    return memoryTeams.size;
  }
  const supabase = getClient();
  const { count, error } = await supabase.from("teams").select("*", { count: "exact", head: true });
  if (error) {
    throw error;
  }
  return count ?? 0;
};

export const deleteAllTeams = async (): Promise<void> => {
  if (isMemoryMode()) {
    memoryTeams.clear();
    return;
  }
  const supabase = getClient();
  await supabase.from("team_provider_mappings").delete().neq("id", "");
  await supabase.from("teams").delete().neq("id", "");
};
