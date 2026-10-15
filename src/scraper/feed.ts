import type { Match } from "./models.ts";

export const BASE_URL = "https://www.diretta.it";
const FEED_URL = BASE_URL + "/x/feed/{feed}";
const ODDS_URL = "https://global.ds.lsapp.eu/odds/pq_graphql";
const FSIGN = "SW9D1eZo";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const RECORD_SEP = "~";
const FIELD_SEP = "\u00ac";
const KV_SEP = "\u00f7";

export const SPORTS: Record<number, string> = {
  1: "calcio",
  2: "tennis",
  3: "basket",
  4: "hockey",
  6: "handball",
  7: "volley",
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

const INCIDENT_TYPES: Record<number, string> = {
  1: "CARTELLINO_GIALLO",
  2: "CARTELLINO_ROSSO",
  3: "GOL",
  4: "AUTOGOL",
  5: "RIGORE",
  6: "SOSTITUZIONE_OUT",
  7: "SOSTITUZIONE_IN",
  8: "ASSIST",
  9: "SOSPENSIONE",
  10: "RIGORE_SEGNATO",
  11: "RIGORE_SBAGLIATO",
  22: "CARTELLINI_ROSSI",
  23: "CARTELLINI_GIALLO",
};

type Record_ = Record<string, string>;

export class FeedError extends Error {
  override readonly name = "FeedError";
}

function normHandicap(value: unknown): unknown {
  if (value !== null && typeof value === "object") {
    return (value as Record<string, unknown>)["value"];
  }
  return value;
}

function selectionLabel(
  betType: string,
  count: number,
  item: Record<string, unknown>,
  index: number,
): string | null {
  if (betType === "HOME_DRAW_AWAY") {
    if (item["eventParticipantId"] === null || item["eventParticipantId"] === undefined) {
      return "X";
    }
    return index === 0 ? "1" : "2";
  }
  if (betType === "HOME_AWAY") {
    return index === 0 ? "1" : "2";
  }
  if (betType === "BOTH_TEAMS_TO_SCORE") {
    return index === 0 ? "SI" : "NO";
  }
  if (betType === "DOUBLE_CHANCE") {
    return index < 3 ? (["1X", "12", "X2"] as const)[index]! : null;
  }
  if (betType === "DRAW_NO_BET") {
    return index === 0 ? "1" : "2";
  }
  if (betType === "OVER_UNDER") {
    return index < count / 2 ? "OVER" : "UNDER";
  }
  return null;
}

async function httpGet(url: string, headers: Record<string, string> = {}, timeoutMs = 15000): Promise<string> {
  const baseHeaders: Record<string, string> = {
    "x-fsign": FSIGN,
    "User-Agent": USER_AGENT,
    Accept: "*/*",
    Referer: BASE_URL + "/",
    ...headers,
  };
  let response: Response;
  try {
    response = await fetch(url, { headers: baseHeaders, signal: AbortSignal.timeout(timeoutMs) });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    throw new FeedError(`Errore di rete per ${url}: ${message}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new FeedError(`HTTP ${response.status} per ${url}: ${text.slice(0, 120)}`);
  }
  return text;
}

function toRecords(text: string): Record_[] {
  const records: Record_[] = [];
  for (const chunk of text.split(RECORD_SEP)) {
    const fields: Record_ = {};
    for (const part of chunk.split(FIELD_SEP)) {
      if (part.includes(KV_SEP)) {
        const idx = part.indexOf(KV_SEP);
        const key = part.slice(0, idx);
        const value = part.slice(idx + KV_SEP.length);
        fields[key] = value;
      }
    }
    if (Object.keys(fields).length > 0) {
      records.push(fields);
    }
  }
  return records;
}

function toInt(value: string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export async function fetchFeed(feed: string): Promise<Record_[]> {
  return toRecords(await httpGet(FEED_URL.replace("{feed}", feed)));
}

function logo(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return `https://static.flashscore.com/res/image/data/${value}`;
}

export function liveMinute(match: Match, now?: number): string | null {
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

export async function fetchMatches(sport = 1): Promise<Match[]> {
  const records = await fetchFeed(`f_${sport}_0_3_it_1`);
  const matches: Match[] = [];
  let tournament: Record_ | null = null;
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

export async function fetchDetail(matchId: string): Promise<Record<string, unknown>> {
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

export async function fetchStatistics(matchId: string): Promise<{ groups: unknown[] }> {
  const records = await fetchFeed(`df_st_1_${matchId}`);
  const groups: Array<{ period: string; stats: unknown[] }> = [];
  let current: { period: string; stats: unknown[] } | null = null;
  for (const rec of records) {
    if ("SF" in rec || "SE" in rec) {
      const title = rec["SF"] ?? rec["SE"] ?? "Statistiche";
      current = { period: title, stats: [] };
      groups.push(current);
      if (!("SD" in rec)) {
        continue;
      }
    }
    if ("SD" in rec && current !== null) {
      current.stats.push({
        id: toInt(rec["SD"]),
        name: rec["SG"] ?? "",
        home: rec["SH"] ?? "",
        away: rec["SI"] ?? "",
      });
    }
  }
  return { groups };
}

export async function fetchEvents(matchId: string): Promise<unknown[]> {
  const raw = await httpGet(FEED_URL.replace("{feed}", `df_sui_1_${matchId}`));
  const events: unknown[] = [];
  let period: string | null = null;
  for (const chunk of raw.split(RECORD_SEP)) {
    const tokens: Array<[string, string]> = [];
    for (const part of chunk.split(FIELD_SEP)) {
      const idx = part.indexOf(KV_SEP);
      if (idx >= 0) {
        tokens.push([part.slice(0, idx), part.slice(idx + KV_SEP.length)]);
      }
    }
    const keys = new Set(tokens.map(([k]) => k));
    if (!keys.has("III")) {
      for (const [key, value] of tokens) {
        if (key === "AC") {
          period = value;
        }
      }
      continue;
    }
    const row: Record<string, string> = {};
    for (const [key, value] of tokens) {
      if (key === "IA" || key === "IB" || key === "INX" || key === "IOX") {
        row[key] = value;
      }
    }
    const side = toInt(row["IA"]);
    const minute = row["IB"] ?? null;
    const homeScore = toInt(row["INX"]);
    const awayScore = toInt(row["IOX"]);
    const incidents: Array<Record<string, string | number | null>> = [];
    let current: Record<string, string | number | null> | null = null;
    for (const [key, value] of tokens) {
      if (key === "IE") {
        current = { type_code: toInt(value) };
        incidents.push(current);
      } else if ((key === "IF" || key === "IK" || key === "IM" || key === "IU") && current !== null) {
        current[key] = value;
      }
    }
    for (const incident of incidents) {
      const typeName = (incident["IK"] as string | undefined) ?? null;
      const typeCode = incident["type_code"];
      events.push({
        minute,
        period,
        side: side === 1 ? "home" : side === 2 ? "away" : null,
        type:
          typeCode !== null && typeCode !== undefined
            ? (INCIDENT_TYPES[typeCode as number] ?? typeName ?? "")
            : (typeName ?? ""),
        type_name: typeName,
        player: incident["IF"] ?? null,
        player_id: (incident["IM"] as string | undefined) ?? "",
        score: homeScore !== null && awayScore !== null ? `${homeScore}-${awayScore}` : null,
      });
    }
  }
  return events;
}

export async function fetchLineups(matchId: string): Promise<Record<string, unknown>> {
  const records = await fetchFeed(`df_li_1_${matchId}`);
  const result: Record<string, unknown> = {
    formation: {},
    home: [],
    away: [],
    home_bench: [],
    away_bench: [],
    coaches: {},
  };
  let side: "home" | "away" = "home";
  let section = "starters";
  for (const rec of records) {
    if ("LP" in rec && "LI" in rec) {
      const player = {
        id: rec["LP"],
        name: rec["LI"],
        number: toInt(rec["LJ"]),
        nationality: rec["LQ"] ?? "",
      };
      if (section === "starters" && "LD" in rec) {
        (result["formation"] as Record<string, string>)[side] = rec["LD"]!;
      }
      if (section === "bench") {
        (result[`${side}_bench`] as unknown[]).push(player);
      } else if (section === "coaches") {
        (result["coaches"] as Record<string, unknown>)[side] = player;
      } else {
        (result[side] as unknown[]).push(player);
      }
    } else if ("LB" in rec) {
      const label = rec["LB"] ?? "";
      if (label.includes("Panchina")) {
        section = "bench";
      } else if (label.includes("Allenator")) {
        section = "coaches";
      } else {
        section = "starters";
      }
      side = "home";
    } else if ("LC" in rec && !("LA" in rec) && !("LB" in rec)) {
      side = side === "home" ? "away" : "home";
    }
  }
  return result;
}

export async function fetchOdds(
  matchId: string,
  geo = "IT",
  projectId = 2,
): Promise<{ bookmakers: string[]; markets: unknown[] }> {
  const params = new URLSearchParams({
    _hash: "oce",
    eventId: matchId,
    projectId: String(projectId),
    geoIpCode: geo,
    geoIpSubdivisionCode: "",
  });
  const raw = await httpGet(`${ODDS_URL}?${params.toString()}`, {
    Origin: BASE_URL,
    Accept: "application/json",
  });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { bookmakers: [], markets: [] };
  }
  const data = (payload["data"] as Record<string, unknown> | undefined) ?? {};
  const event = (data["findOddsByEventId"] as Record<string, unknown> | undefined) ?? {};
  if (!event || Object.keys(event).length === 0) {
    return { bookmakers: [], markets: [] };
  }

  const bookmakers: Record<string, string> = {};
  const settings = (event["settings"] as Record<string, unknown> | undefined) ?? {};
  for (const entry of (settings["bookmakers"] as Array<Record<string, unknown>> | undefined) ?? []) {
    const bookmaker = (entry["bookmaker"] as Record<string, unknown> | undefined) ?? {};
    bookmakers[String(bookmaker["id"])] = (bookmaker["name"] as string | undefined) ?? "";
  }

  const markets: Array<Record<string, unknown>> = [];
  for (const entry of (event["odds"] as Array<Record<string, unknown>> | undefined) ?? []) {
    const oddsItems = (entry["odds"] as Array<Record<string, unknown>> | undefined) ?? [];
    if (oddsItems.length === 0) {
      continue;
    }
    const betType = (entry["bettingType"] as string | undefined) ?? "";
    const count = oddsItems.length;
    const outcomes = oddsItems.map((item, index) => ({
      label: selectionLabel(betType, count, item, index),
      value: item["value"],
      opening: item["opening"],
      handicap: normHandicap(item["handicap"]),
      active: item["active"],
    }));
    markets.push({
      bookmaker_id: String(entry["bookmakerId"]),
      bookmaker: bookmakers[String(entry["bookmakerId"])] ?? "",
      bet_type: betType,
      scope: entry["bettingScope"],
      live: entry["hasLiveBettingOffers"],
      outcomes,
    });
  }
  const activeBooks = [...new Set(markets.map((m) => m["bookmaker"] as string).filter((b) => b))].sort();
  return { bookmakers: activeBooks, markets };
}

export async function enrichMatch(match: Match, options: Set<string>, geo: string): Promise<void> {
  const matchId = match.id;
  try {
    if (options.has("stats")) {
      match["statistics"] = await fetchStatistics(matchId);
    }
    if (options.has("events")) {
      match["events"] = await fetchEvents(matchId);
    }
    if (options.has("lineups")) {
      match["lineups"] = await fetchLineups(matchId);
    }
    if (options.has("odds")) {
      match["odds"] = await fetchOdds(matchId, geo);
    }
    if (options.has("detail")) {
      match["detail"] = await fetchDetail(matchId);
    }
  } catch (exc) {
    if (exc instanceof FeedError) {
      match["enrich_error"] = exc.message;
    } else {
      throw exc;
    }
  }

  const detail = match["detail"] as Record<string, unknown> | undefined;
  if (detail && detail["home_score"] !== null && detail["home_score"] !== undefined && detail["away_score"] !== null && detail["away_score"] !== undefined) {
    match["home_score"] = detail["home_score"] as number;
    match["away_score"] = detail["away_score"] as number;
    if (detail["stage_id"] !== null && detail["stage_id"] !== undefined) {
      match["stage_id"] = detail["stage_id"] as number;
    }
    if (detail["stage_start"]) {
      match["stage_start"] = detail["stage_start"] as number;
    }
    match["minute"] = liveMinute(match);
  }
}

async function mapPool<T>(items: T[], workers: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const size = Math.max(1, Math.min(workers, items.length));
  const run = async (): Promise<void> => {
    while (index < items.length) {
      const current = index++;
      await fn(items[current]!);
    }
  };
  await Promise.all(Array.from({ length: size }, run));
}

export async function collect(
  sport: number,
  scope: string,
  filterText: string | null,
  options: Set<string>,
  geo: string,
  workers: number,
): Promise<Match[]> {
  let matches = await fetchMatches(sport);
  if (scope === "live") {
    matches = matches.filter((m) => m.is_live);
  }
  if (filterText) {
    const needle = filterText.toLowerCase();
    matches = matches.filter(
      (m) =>
        (m.home ?? "").toLowerCase().includes(needle) ||
        (m.away ?? "").toLowerCase().includes(needle) ||
        (m.tournament ?? "").toLowerCase().includes(needle),
    );
  }
  if (options.size > 0 && matches.length > 0) {
    await mapPool(matches, workers, (m) => enrichMatch(m, options, geo));
  }
  return matches;
}

export async function singleMatch(
  matchId: string,
  sport: number,
  options: Set<string>,
  geo: string,
): Promise<Match> {
  let match: Match | null = null;
  try {
    for (const candidate of await fetchMatches(sport)) {
      if (candidate.id === matchId) {
        match = candidate;
        break;
      }
    }
  } catch {
    match = null;
  }
  if (match === null) {
    match = {
      id: matchId,
      sport,
      tournament: "",
      country: "",
      home: "",
      away: "",
      home_score: null,
      away_score: null,
      start_time: null,
      status: "",
      status_code: null,
      stage_id: null,
      is_live: false,
      minute: null,
    };
  }
  await enrichMatch(match, new Set([...options, "detail"]), geo);
  return match;
}
