import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Match } from "./models.ts";
import { getSettings } from "../config.ts";
import { formatDateItalian } from "./date.ts";

let client: SupabaseClient | null = null;

const getClient = (): SupabaseClient => {
  if (client) {
    return client;
  }
  const settings = getSettings();
  const url = settings.supabaseUrl;
  const key = settings.supabaseServiceRoleKey;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return client;
};

export const dbPath = (): string => {
  try {
    const settings = getSettings();
    return settings.supabaseUrl || "supabase";
  } catch {
    return "supabase";
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

export const upsertMatches = async (matches: Match[]): Promise<number> => {
  if (matches.length === 0) {
    return 0;
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
  const supabase = getClient();
  const { count, error } = await supabase.from("matches").select("*", { count: "exact", head: true });
  if (error) {
    throw error;
  }
  return count ?? 0;
};

export const deleteAll = async (): Promise<void> => {
  const supabase = getClient();
  await supabase.from("matches").delete().neq("id", "");
};
