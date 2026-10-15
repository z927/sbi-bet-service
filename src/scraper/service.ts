import * as scraper from "./feed.ts";
import * as db from "./db.ts";
import type { Match } from "./models.ts";

export const ENRICH_CHOICES = ["detail", "stats", "events", "lineups", "odds"] as const;

type CacheKey = string;
const cache = new Map<CacheKey, { at: number; matches: Match[] }>();

export function ttlSeconds(): number {
  return Number.parseFloat(process.env["DIRETTA_CACHE_TTL"] ?? "15");
}

function cacheKey(
  sport: number,
  scope: string,
  filterText: string | null,
  enrich: readonly string[],
  geo: string,
): CacheKey {
  return JSON.stringify([sport, scope, filterText, [...enrich], geo]);
}

export async function getMatches(
  sport = 1,
  scope = "live",
  filterText: string | null = null,
  enrich: readonly string[] = [],
  geo = "IT",
  workers = 8,
  refresh = false,
): Promise<[Match[], boolean]> {
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

export async function getMatch(
  matchId: string,
  sport = 1,
  enrich: readonly string[] = ["detail"],
  geo = "IT",
): Promise<Match | null> {
  const match = await scraper.singleMatch(matchId, sport, new Set(enrich), geo);
  db.upsertMatches([match]);
  return match;
}

export function clearCache(): void {
  cache.clear();
}
