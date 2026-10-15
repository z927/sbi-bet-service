import * as scraper from "./feed.ts";
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

  const matches = await scraper.collect(sport, scope, filterText, new Set(enrich), geo, workers);
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
  const match = await scraper.singleMatch(matchId, sport, new Set(enrich), geo);
  db.upsertMatches([match]);
  return match;
}

export const clearCache = (): void => {
  cache.clear();
}

export const testScrape = async (sport = 1, scope = "live", sampleLimit = 3): Promise<ScrapeTestResponse> => {
  const feed = scraper.feedName(sport);
  const started = Date.now();
  try {
    const matches = await scraper.collect(sport, scope, null, new Set(), "IT", 4);
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
