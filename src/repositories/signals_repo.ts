import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSettings } from "../config/config.ts";
import { getStrategyLogger } from "../config/logger.ts";
import type { Alert } from "../models/alert.ts";
import type { Match, Statistics } from "../scraper/models.ts";

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
  fixtureId?: number;
  homeScoreHt?: number | null;
  awayScoreHt?: number | null;
}

export interface UnsettledSignal {
  match_id: string;
  home: string | null;
  away: string | null;
  rule: string | null;
  text: string | null;
  created_at: string | null;
  fixture_id: number | null;
  home_score_ht: number | null;
  away_score_ht: number | null;
  type: string | null;
}

export const getUnsettledSignals = async (): Promise<UnsettledSignal[] | null> => {
  let supabase: SupabaseClient;
  try {
    supabase = getClient();
  } catch (exc) {
    getStrategyLogger().error({ err: exc, component: "signals_repo" }, "getUnsettledSignals client failed");
    return null;
  }
  const { data, error } = await supabase.from("signals").select("match_id, home, away, rule, text, created_at, fixture_id, home_score_ht, away_score_ht, type").is("win", null);
  if (error) {
    getStrategyLogger().error({ err: error, component: "signals_repo" }, "getUnsettledSignals failed");
    return null;
  }
  return (data ?? []) as UnsettledSignal[];
};

export const updateSignalResult = async (
  matchId: string,
  patch: { homeScore: number; awayScore: number; win?: boolean; homeScoreHt?: number | null; awayScoreHt?: number | null; goalMinute?: number | null },
): Promise<void> => {
  const supabase = getClient();
  const update: { home_score: number; away_score: number; win?: boolean; home_score_ht?: number | null; away_score_ht?: number | null; first_goal_minute?: number | null } = {
    home_score: patch.homeScore,
    away_score: patch.awayScore,
  };
  if (patch.win !== undefined) {
    update.win = patch.win;
  }
  if (patch.homeScoreHt !== undefined) {
    update.home_score_ht = patch.homeScoreHt;
  }
  if (patch.awayScoreHt !== undefined) {
    update.away_score_ht = patch.awayScoreHt;
  }
  if (patch.goalMinute !== undefined) {
    update.first_goal_minute = patch.goalMinute;
  }
  const { error } = await supabase.from("signals").update(update).eq("match_id", matchId);
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
      home_score_ht: context?.homeScoreHt ?? null,
      away_score_ht: context?.awayScoreHt ?? null,
      touches: alert.touches ?? null,
      odds: alert.odds ?? null,
      type: alert.type ?? null,
      statistics: statistics ?? null,
      match_data: match ?? null,
      fixture_id: context?.fixtureId ?? null,
    });
  } catch (err) {
    getStrategyLogger().error(
      { err, rule: alert.rule, matchId: alert.matchId },
      "signal save failed",
    );
  }
};
