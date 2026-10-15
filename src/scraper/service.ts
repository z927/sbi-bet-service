import { client, FeedError, feedName, liveMinute } from "./client/index.ts";
import * as db from "./db.ts";
import type { Match, ScrapeTestResponse } from "./models.ts";

export const ENRICH_CHOICES = ["detail", "stats", "events", "lineups", "odds"] as const;

type CacheKey = string;
const cache = new Map<CacheKey, { at: number; matches: Match[] }>();

export const ttlSeconds = (): number => {
  return Number.parseFloat(process.env["DIRETTA_CACHE_TTL"] ?? "15");
}

const cacheKey = (
  sport: number,
  scope: string,
  filterText: string | null,
  enrich: readonly string[],
  geo: string,
): CacheKey => {
  return JSON.stringify([sport, scope, filterText, [...enrich], geo]);
}

const mapPool = async <T>(items: T[], workers: number, fn: (item: T) => Promise<void>): Promise<void> => {
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

export const enrichMatch = async (match: Match, options: Set<string>, geo: string): Promise<void> => {
  const matchId = match.id;
  try {
    if (options.has("stats")) {
      match["statistics"] = await client.getStatistics(matchId);
    }
    if (options.has("events")) {
      match["events"] = await client.getEvents(matchId);
    }
    if (options.has("lineups")) {
      match["lineups"] = await client.getLineups(matchId);
    }
    if (options.has("odds")) {
      match["odds"] = await client.getOdds(matchId, geo);
    }
    if (options.has("detail")) {
      match["detail"] = await client.getMatch(matchId);
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

export const collect = async (
  sport: number,
  scope: string,
  filterText: string | null,
  options: Set<string>,
  geo: string,
  workers: number,
): Promise<Match[]> => {
  let matches = await client.listMatches(sport);
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

export const singleMatch = async (
  matchId: string,
  sport: number,
  options: Set<string>,
  geo: string,
): Promise<Match> => {
  let match: Match | null = null;
  try {
    for (const candidate of await client.listMatches(sport)) {
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

export const getMatches = async (
  sport = 1,
  scope = "live",
  filterText: string | null = null,
  enrich: readonly string[] = [],
  geo = "IT",
  workers = 8,
  refresh = false,
): Promise<[Match[], boolean]> => {
  const key = cacheKey(sport, scope, filterText, enrich, geo);
  const current = Date.now() / 1000;

  if (!refresh) {
    const hit = cache.get(key);
    if (hit && current - hit.at < ttlSeconds()) {
      return [hit.matches, true];
    }
  }

  const matches = await collect(sport, scope, filterText, new Set(enrich), geo, workers);
  db.upsertMatches(matches);
  cache.set(key, { at: current, matches });
  return [matches, false];
}

export const getMatch = async (
  matchId: string,
  sport = 1,
  enrich: readonly string[] = ["detail"],
  geo = "IT",
): Promise<Match | null> => {
  const match = await singleMatch(matchId, sport, new Set(enrich), geo);
  db.upsertMatches([match]);
  return match;
}

export const clearCache = (): void => {
  cache.clear();
}

export const testScrape = async (sport = 1, scope = "live", sampleLimit = 3): Promise<ScrapeTestResponse> => {
  const feed = feedName(sport);
  const started = Date.now();
  try {
    const matches = await collect(sport, scope, null, new Set(), "IT", 4);
    const stored = db.upsertMatches(matches);
    return {
      ok: true,
      sport,
      scope,
      feed,
      elapsed_ms: Date.now() - started,
      matches_parsed: matches.length,
      live_matches: matches.filter((m) => m.is_live).length,
      stored,
      sample: matches.slice(0, sampleLimit),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      sport,
      scope,
      feed,
      elapsed_ms: Date.now() - started,
      matches_parsed: 0,
      live_matches: 0,
      stored: 0,
      sample: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
