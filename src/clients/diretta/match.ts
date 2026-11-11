import { fetchFeed, toInt } from "./transport.ts";

export const getMatch = async (matchId: string): Promise<Record<string, unknown>> => {
  const records = await fetchFeed(`dc_1_${matchId}`);
  const rec = records[0];
  if (!rec) {
    return {};
  }
  return {
    stage_type: toInt(rec["DA"]),
    stage_id: toInt(rec["DB"]),
    stage_start: toInt(rec["DD"]),
    start_time: toInt(rec["DC"]),
    end_time: toInt(rec["DS"]),
    home_score: toInt(rec["DE"]),
    away_score: toInt(rec["DF"]),
    home_ht_score: toInt(rec["DG"]),
    away_ht_score: toInt(rec["DH"]),
    game_time: toInt(rec["DI"]),
    last_update: toInt(rec["DK"]),
    available_feeds: (rec["DX"] ?? "").split(",").filter((f) => f !== ""),
  };
}
