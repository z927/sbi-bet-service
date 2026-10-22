import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSettings } from "../../config.ts";
import type { Alert } from "./alert.ts";
import type { Match, Statistics } from "../../scraper/models.ts";

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

export interface SaveSignalContext {
  match?: Match;
  statistics?: Statistics;
}

export const saveSignal = async (alert: Alert, context?: SaveSignalContext): Promise<void> => {
  try {
    const supabase = getClient();
    const match = context?.match;
    const statistics = context?.statistics;

    await supabase.from("signals").insert({
      rule: alert.rule,
      match_id: alert.matchId,
      home: alert.home,
      away: alert.away,
      tournament: alert.tournament ?? match?.tournament ?? null,
      country: alert.country ?? match?.country ?? null,
      minute: alert.minute,
      value: alert.value,
      threshold: alert.threshold,
      text: alert.text,
      home_score: alert.homeScore ?? match?.home_score ?? null,
      away_score: alert.awayScore ?? match?.away_score ?? null,
      touches: alert.touches ?? null,
      odds: alert.odds ?? null,
      statistics: statistics ?? null,
      match_data: match ?? null,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[signals] failed to save signal for ${alert.matchId} (${alert.rule}): ${error}`);
  }
};
