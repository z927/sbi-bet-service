import { fetchFeed, toInt, type FeedRecord } from "./transport.ts";
import type { Match } from "../models.ts";

export const SPORTS: Record<number, string> = {
  1: "calcio",
};

const STATUS_NAMES: Record<number, string> = {
  1: "PROGRAMMATA",
  2: "LIVE",
  3: "FINITA",
  4: "RINVIATA",
  5: "ANNULLATA",
  6: "SUPPLEMENTARI",
  7: "RIGORI",
  8: "RITIRATA",
  9: "WALKOVER",
  10: "DOPO SUPPLEMENTARI",
  11: "DOPO RIGORI",
  12: "1° TEMPO",
  13: "2° TEMPO",
  36: "INTERROTTA",
  37: "ABBANDONATA",
  38: "INTERVALLO",
  39: "TIME OUT",
  42: "IN ATTESA",
  43: "RINVIATA",
};

const LIVE_STATUSES = new Set([2, 6, 7, 10, 11, 12, 13, 36, 39]);

const STAGE_OFFSETS: Record<number, number> = { 12: 0, 13: 45, 6: 90 };
const HALFTIME_STAGES = new Set([38]);

export const feedName = (sport: number): string => {
  return `f_${sport}_0_3_it_1`;
}

export const liveMinute = (match: Match, now?: number): string | null => {
  if (!match.is_live) {
    return null;
  }
  const stage = match.stage_id;
  if (stage === null || stage === undefined) {
    return null;
  }
  if (HALFTIME_STAGES.has(stage)) {
    return "Intervallo";
  }
  if (stage === 7) {
    return "Rigori";
  }
  if (stage === 10 || stage === 11) {
    return "DTS";
  }
  const offset = STAGE_OFFSETS[stage];
  if (offset === undefined) {
    return null;
  }
  const start = match.stage_start;
  if (!start) {
    return null;
  }
  const current = now ?? Date.now() / 1000;
  let minute = Math.trunc(offset + (current - start) / 60 + 1);
  if (minute < 1) {
    minute = 1;
  }
  return `${minute}'`;
}

const logo = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }
  return `https://static.flashscore.com/res/image/data/${value}`;
}

export const listMatches = async (sport = 1): Promise<Match[]> => {
  const records = await fetchFeed(feedName(sport));
  const matches: Match[] = [];
  let tournament: FeedRecord | null = null;
  for (const rec of records) {
    if ("ZA" in rec) {
      tournament = {
        name: rec["ZA"]!,
        country: rec["ZY"] ?? "",
        tournament_id: rec["ZEE"] ?? "",
        stage_id: rec["ZC"] ?? "",
        url: rec["ZL"] ?? "",
      };
      continue;
    }
    if (!("AA" in rec)) {
      continue;
    }
    const status = toInt(rec["AB"]);
    const stageId = toInt(rec["AC"]);
    const match: Match = {
      id: rec["AA"]!,
      sport,
      tournament: tournament?.["name"] ?? "",
      country: tournament?.["country"] ?? "",
      tournament_id: tournament?.["tournament_id"] ?? "",
      league_url: tournament?.["url"] ?? "",
      start_time: toInt(rec["AD"]),
      status_code: status,
      status: status !== null ? (STATUS_NAMES[status] ?? String(status)) : "",
      stage_id: stageId,
      is_live: (status !== null && LIVE_STATUSES.has(status)) || rec["AI"] === "y",
      stage_start: toInt(rec["AO"]),
      home: rec["AE"] ?? rec["CX"] ?? rec["FH"] ?? "",
      away: rec["AF"] ?? rec["FK"] ?? "",
      home_short: rec["WM"] ?? "",
      away_short: rec["WN"] ?? "",
      home_score: toInt(rec["AG"]),
      away_score: toInt(rec["AH"]),
      home_id: rec["PX"] ?? "",
      away_id: rec["PY"] ?? "",
      home_logo: logo(rec["OA"]),
      away_logo: logo(rec["OB"]),
      minute: null,
    };
    match.minute = liveMinute(match);
    matches.push(match);
  }
  return matches;
}
