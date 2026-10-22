import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Match } from "./models.ts";
import { getSettings } from "../config.ts";
import { formatDateItalian } from "./date.ts";

let client: SupabaseClient | null = null;
let useMemory = false;
const memoryMatches = new Map<string, Match>();
const memoryMeta = new Map<string, { sport: number | null; is_live: boolean; tournament: string; start_time: number | null }>();

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

export const dbPath = (): string => {
  if (useMemory) {
    return process.env["DIRETTA_DB"] ?? "memory";
  }
  try {
    const settings = getSettings();
    return settings.supabaseUrl || "supabase";
  } catch {
    return process.env["DIRETTA_DB"] ?? "memory";
  }
};

export const initDb = (): void => {
  // Tables are managed via Supabase migrations.
};

const nowIso = (): string => new Date().toISOString();

const asInt = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
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

export const upsertMatches = async (matches: Match[]): Promise<number> => {
  if (matches.length === 0) {
    return 0;
  }
  if (isMemoryMode()) {
    let stored = 0;
    const timestamp = nowIso();
    for (const match of matches) {
      const matchId = match.id;
      if (!matchId) continue;
      memoryMatches.set(matchId, match);
      memoryMeta.set(matchId, {
        sport: asInt(match.sport),
        is_live: match.is_live ? true : false,
        tournament: match.tournament ?? "",
        start_time: asInt(match.start_time),
      });
      stored += 1;
    }
    return stored;
  }

  const supabase = getClient();
  const timestamp = nowIso();
  let stored = 0;

  for (const match of matches) {
    const matchId = match.id;
    if (!matchId) {
      continue;
    }

    const homeScore = asInt(match.home_score);
    const awayScore = asInt(match.away_score);
    const statusCode = asInt(match.status_code);
    const stageId = asInt(match.stage_id);
    const minute = (match.minute ?? null) as string | null;
    const isLive = match.is_live ? true : false;
    const startTime = asInt(match.start_time);
    const matchDate = formatDateItalian(startTime);

    await supabase.from("matches").upsert(
      {
        id: matchId,
        sport: asInt(match.sport),
        tournament: match.tournament ?? "",
        country: match.country ?? "",
        home: match.home ?? "",
        away: match.away ?? "",
        home_score: homeScore,
        away_score: awayScore,
        status: match.status ?? "",
        status_code: statusCode,
        stage_id: stageId,
        is_live: isLive,
        minute,
        start_time: startTime,
        date: matchDate,
        data: match as unknown as Record<string, unknown>,
        updated_at: timestamp,
      },
      { onConflict: "id" },
    );

    stored += 1;
  }

  return stored;
};

export const getMatches = async (
  sport: number | null = null,
  scope = "live",
  filterText: string | null = null,
  limit = 500,
): Promise<Match[]> => {
  if (isMemoryMode()) {
    const results: Match[] = [];
    for (const [id, match] of memoryMatches.entries()) {
      const meta = memoryMeta.get(id);
      if (sport !== null && meta?.sport !== sport) continue;
      if (scope === "live" && !meta?.is_live) continue;
      if (filterText) {
        const needle = filterText.toLowerCase();
        const hay = `${match.home ?? ""} ${match.away ?? ""} ${match.tournament ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) continue;
      }
      results.push(match);
    }
    results.sort((a, b) => {
      const ta = a.tournament ?? "";
      const tb = b.tournament ?? "";
      if (ta !== tb) return ta.localeCompare(tb);
      const sa = asInt(a.start_time) ?? 0;
      const sb = asInt(b.start_time) ?? 0;
      return sa - sb;
    });
    return results.slice(0, limit);
  }

  const supabase = getClient();
  let query = supabase.from("matches").select("data");

  if (sport !== null) {
    query = query.eq("sport", sport);
  }
  if (scope === "live") {
    query = query.eq("is_live", true);
  }
  if (filterText) {
    const needle = filterText.toLowerCase();
    query = query.or(`home.ilike.%${needle}%,away.ilike.%${needle}%,tournament.ilike.%${needle}%`);
  }

  query = query.order("tournament", { ascending: true }).order("start_time", { ascending: true }).limit(limit);

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  if (!data) {
    return [];
  }
  return (data as any[]).map((row) => row.data as Match);
};

export const getMatch = async (matchId: string): Promise<Match | null> => {
  if (isMemoryMode()) {
    return memoryMatches.get(matchId) ?? null;
  }
  const supabase = getClient();
  const { data, error } = await supabase.from("matches").select("data").eq("id", matchId).maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return (data as any).data as Match;
};

export const getSnapshots = async (_matchId: string, _limit = 200): Promise<any[]> => {
  return [];
};

export const countMatches = async (): Promise<number> => {
  if (isMemoryMode()) {
    return memoryMatches.size;
  }
  const supabase = getClient();
  const { count, error } = await supabase.from("matches").select("*", { count: "exact", head: true });
  if (error) {
    throw error;
  }
  return count ?? 0;
};

export const deleteAll = async (): Promise<void> => {
  if (isMemoryMode()) {
    memoryMatches.clear();
    memoryMeta.clear();
    return;
  }
  const supabase = getClient();
  await supabase.from("matches").delete().neq("id", "");
};
