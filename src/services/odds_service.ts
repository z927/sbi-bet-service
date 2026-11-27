import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSettings } from "../config/config.ts";
import { getStrategyLogger } from "../config/logger.ts";
import { fetchFulltimeGoalOdds } from "./signals/fulltime_odds.ts";

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

export interface OddsRecord {
  fixture_id: number;
  match_id?: string | null;
  over_15_odd: number | null;
  over_25_odd: number | null;
}

export const saveOdds = async (record: OddsRecord): Promise<void> => {
  try {
    const supabase = getClient();
    const { error } = await supabase.from("odds").upsert(
      {
        fixture_id: record.fixture_id,
        match_id: record.match_id ?? null,
        over_15_odd: record.over_15_odd,
        over_25_odd: record.over_25_odd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "fixture_id" },
    );
    if (error) {
      throw error;
    }
  } catch (exc) {
    getStrategyLogger().error(
      { err: exc, fixtureId: record.fixture_id },
      "odds save failed",
    );
  }
};

export interface FulltimeOddsResult {
  over15: number | null;
  over25: number | null;
}

export const fetchAndSaveFulltimeOdds = async (
  fixtureId: number,
  matchId?: string | null,
): Promise<FulltimeOddsResult> => {
  const odds = await fetchFulltimeGoalOdds(fixtureId);
  await saveOdds({
    fixture_id: fixtureId,
    match_id: matchId ?? null,
    over_15_odd: odds.over15,
    over_25_odd: odds.over25,
  });
  return odds;
};

export const isOddsConfigured = (): boolean => {
  try {
    const settings = getSettings();
    return Boolean(settings.supabaseUrl && settings.supabaseServiceRoleKey);
  } catch {
    return false;
  }
};
