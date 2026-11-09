import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSettings } from "../../config.ts";
import { getStrategyLogger } from "../../logger.ts";
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

export interface UnsettledSignal {
  match_id: string;
  home: string | null;
  away: string | null;
  rule: string | null;
  created_at: string | null;
}

export const getUnsettledSignals = async (): Promise<UnsettledSignal[] | null> => {
  let supabase: SupabaseClient;
  try {
    supabase = getClient();
  } catch (exc) {
    getStrategyLogger().error({ err: exc, component: "signals_repo" }, "getUnsettledSignals client failed");
    return null;
  }
  const { data, error } = await supabase.from("signals").select("match_id, home, away, rule, created_at").is("win", null);
  if (error) {
    getStrategyLogger().error({ err: error, component: "signals_repo" }, "getUnsettledSignals failed");
    return null;
  }
  return (data ?? []) as UnsettledSignal[];
};

export const updateSignalResult = async (
  matchId: string,
  patch: { homeScore: number; awayScore: number; win: boolean },
): Promise<void> => {
  const supabase = getClient();
  const { error } = await supabase.from("signals").update({
    home_score: patch.homeScore,
    away_score: patch.awayScore,
    win: patch.win,
  }).eq("match_id", matchId);
  if (error) {
    getStrategyLogger().error({ err: error, component: "signals_repo", matchId }, "updateSignalResult failed");
    throw error;
  }
};

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
      type: alert.type ?? null,
      statistics: statistics ?? null,
      match_data: match ?? null,
    });
  } catch (err) {
    getStrategyLogger().error(
      { err, rule: alert.rule, matchId: alert.matchId },
      "signal save failed",
    );
  }
};
