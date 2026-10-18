import type { Match } from "../../scraper/models.ts";

export const MAJOR_LEAGUES_ENV = "MONITOR_MAJOR_LEAGUES";

export const DEFAULT_MAJOR_LEAGUES: readonly string[] = [
  "ITALIA: Serie A",
  "INGHILTERRA: Premier League",
  "SPAGNA: LaLiga",
  "GERMANIA: Bundesliga",
  "FRANCIA: Ligue 1",
];

export const configuredMajorLeagues = (env: NodeJS.ProcessEnv = process.env): string[] => {
  const raw = env[MAJOR_LEAGUES_ENV];
  if (raw === undefined || raw.trim() === "") {
    return [...DEFAULT_MAJOR_LEAGUES];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export const isMajorLeague = (match: Match, allowlist: readonly string[]): boolean => {
  const name = (match.tournament ?? "").trim().toLowerCase();
  const id = (match.tournament_id ?? "").trim().toLowerCase();
  return allowlist.some((entry) => {
    const value = entry.trim().toLowerCase();
    return value !== "" && (name === value || id === value);
  });
}
