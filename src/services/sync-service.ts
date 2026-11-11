import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listMatches } from "../clients/diretta/matches.ts";

interface LeagueEntry {
  leagueId: number;
  tournamentId: string;
}

interface SyncResult {
  apiFootball: string[];
  diretta: string[];
  similarities: { from: string; to: string | null; distance: number }[];
}

const levenshtein = (a: string, b: string): number => {
  const m = a.length; const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[m]![n]!;
};

const getTeamsByLeagueAndSeason = async (league: number, season: string): Promise<string[]> => {
  const key = process.env.API_FOOTBALL_KEY ?? "";
  const res = await fetch(`https://v3.football.api-sports.io/teams?league=${league}&season=${season}`, {
    headers: { "x-apisports-key": key },
  });
  const data = (await res.json()) as { response?: { team: { name: string } }[] };
  return (data.response ?? []).map((t) => t.team.name).sort((a, b) => a.localeCompare(b));
};

const getTeamsByTournamentId = async (tournamentId: string): Promise<string[]> => {
  const matches = await listMatches(1);
  console.log(matches);
  
  const names = new Set<string>();
  for (const m of matches) {
    if ((m.tournament_id ?? "") !== tournamentId) continue;
    if (m.home) names.add(m.home);
    if (m.away) names.add(m.away);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
};

const findSimilarities = (arr1: string[], arr2: string[]) => {
  return arr1.map((str1) => {
    let closest: { str: string | null; distance: number } = { str: null, distance: Infinity };
    for (const str2 of arr2) {
      const distance = levenshtein(str1, str2);
      if (distance < closest.distance) closest = { str: str2, distance };
    }
    return { from: str1, to: closest.str, distance: closest.distance };
  });
};

export const runSync = async (
  leagues: LeagueEntry[],
  season = process.env.API_FOOTBALL_CURRENT_SEASON ?? "",
): Promise<SyncResult[]> => {
  const results: SyncResult[] = [];
  for (const league of leagues) {
    const teams = await getTeamsByLeagueAndSeason(league.leagueId, season);
    const direttaTeams = await getTeamsByTournamentId(league.tournamentId);
    const similarities = findSimilarities(teams, direttaTeams);
    results.push({ apiFootball: teams, diretta: direttaTeams, similarities });
  }
  return results;
};

export interface DirettaTournament {
  tournamentId: string;
  tournament: string;
}

export const listDirettaTournaments = async (filter?: string): Promise<DirettaTournament[]> => {
  const matches = await listMatches(1);
  const map = new Map<string, string>();
  for (const m of matches) {
    const id = (m.tournament_id ?? "").trim();
    const name = (m.tournament ?? "").trim();
    if (id === "" || name === "") continue;
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) continue;
    if (!map.has(id)) map.set(id, name);
  }
  return [...map.entries()].map(([tournamentId, tournament]) => ({ tournamentId, tournament }));
};

export const getDirettaTeams = async (tournamentId: string): Promise<string[]> => {
  return getTeamsByTournamentId(tournamentId);
};

export const runSyncFromFile = async (filePath?: string): Promise<SyncResult[]> => {
  const p = filePath ?? join(process.cwd(), "leagues.json");
  const leagues = JSON.parse(readFileSync(p, "utf8")) as LeagueEntry[];
  return runSync(leagues);
};
