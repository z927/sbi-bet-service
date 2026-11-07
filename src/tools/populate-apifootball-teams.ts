import { readFile, writeFile } from "node:fs/promises";

const API_BASE = "https://v3.football.api-sports.io";
const API_KEY = process.env.APIFOOTBALL_KEY || process.env.RAPIDAPI_KEY;

if (!API_KEY) {
  console.error("Imposta APIFOOTBALL_KEY o RAPIDAPI_KEY");
  process.exit(1);
}

const SEASONS = ["2026", "2025", "2024"];
const TEAMS_PATH = "src/res/teams.json";
const DELAY_MS = 2500;

async function apiFetch(path: string, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        "x-rapidapi-key": API_KEY,
        "x-rapidapi-host": "v3.football.api-sports.io",
      },
    });
    if (res.status === 429) {
      const wait = Math.pow(2, i + 1) * 5;
      console.log(`  rate limit, attesa ${wait}s...`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) {
      throw new Error(`API-Football ${path}: ${res.status}`);
    }
    return res.json();
  }
  throw new Error(`API-Football ${path}: rate limit persistente`);
}

type TeamEntry = {
  diretta: string;
  apifootball: number | null;
  apifootballTeamName: string | null;
  apifootballLeague: number | null;
  apifootballLeagueName: string | null;
  direttaLeague: string;
};

type LeagueHint = {
  country: string;
  name: string;
};

const LEAGUE_MAP: Record<string, LeagueHint> = {
  "INGHILTERRA: Premier League": { country: "England", name: "Premier League" },
  "INGHILTERRA: Championship": { country: "England", name: "Championship" },
  "INGHILTERRA: League One": { country: "England", name: "League One" },
  "ITALIA: Serie A": { country: "Italy", name: "Serie A" },
  "ITALIA: Serie B": { country: "Italy", name: "Serie B" },
  "SPAGNA: LaLiga": { country: "Spain", name: "La Liga" },
  "SPAGNA: LaLiga2": { country: "Spain", name: "LaLiga 2" },
  "GERMANIA: Bundesliga": { country: "Germany", name: "Bundesliga" },
  "GERMANIA: 2. Bundesliga": { country: "Germany", name: "2. Bundesliga" },
  "FRANCIA: Ligue 1": { country: "France", name: "Ligue 1" },
  "FRANCIA: Ligue 2": { country: "France", name: "Ligue 2" },
  "FRANCIA: Ligue 3": { country: "France", name: "National" },
  "OLANDA: Eredivisie": { country: "Netherlands", name: "Eredivisie" },
  "OLANDA: Eerste Divisie": { country: "Netherlands", name: "Eerste Divisie" },
  "AUSTRIA: Bundesliga": { country: "Austria", name: "Bundesliga" },
  "BELGIO: Jupiler League": { country: "Belgium", name: "Jupiler Pro League" },
  "DANIMARCA: Superliga": { country: "Denmark", name: "Superliga" },
  "PORTOGALLO: Liga Portugal": { country: "Portugal", name: "Primeira Liga" },
  "PORTOGALLO: Liga Portugal 2": { country: "Portugal", name: "Liga Portugal 2" },
  "REPUBBLICA CECA: 1. Liga": { country: "Czech Republic", name: "Fortuna Liga" },
  "ROMANIA: Superliga": { country: "Romania", name: "Liga 1" },
  "SCOZIA: Premiership": { country: "Scotland", name: "Premiership" },
  "SERBIA: Super Liga": { country: "Serbia", name: "SuperLiga" },
  "SVIZZERA: Super League": { country: "Switzerland", name: "Super League" },
  "TURCHIA: 1. Lig": { country: "Turkey", name: "Süper Lig" },
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function findLeague(leagues: any[], hint: LeagueHint) {
  const exact = leagues.find((l) =>
    l.country?.name?.toLowerCase() === hint.country.toLowerCase() &&
    l.league?.name?.toLowerCase() === hint.name.toLowerCase()
  );
  if (exact) return exact;
  return leagues.find((l) =>
    l.country?.name?.toLowerCase() === hint.country.toLowerCase() &&
    (l.league?.name?.toLowerCase().includes(hint.name.toLowerCase()) ||
      hint.name.toLowerCase().includes(l.league?.name?.toLowerCase() ?? ""))
  );
}

async function main() {
  const raw = await readFile(TEAMS_PATH, "utf-8");
  const teams: TeamEntry[] = JSON.parse(raw);

  // Aggiungi campi nome se mancanti
  for (const t of teams) {
    if (t.apifootballTeamName === undefined) t.apifootballTeamName = null;
    if (t.apifootballLeagueName === undefined) t.apifootballLeagueName = null;
  }

  const leaguesData = await apiFetch("/leagues");
  await sleep(DELAY_MS);
  const leagues: any[] = leaguesData.response;

  const uniqueLeagues = [...new Set(teams.map((t) => t.direttaLeague))];
  const leagueCache = new Map<string, { leagueId: number; leagueName: string; teams: { id: number; name: string }[] }>();

  for (const direttaLeague of uniqueLeagues) {
    const hint = LEAGUE_MAP[direttaLeague];
    if (!hint) {
      console.warn(`Nessun mapping per ${direttaLeague}`);
      continue;
    }

    const league = await findLeague(leagues, hint);
    if (!league) {
      console.warn(`Lega API-Football non trovata per ${direttaLeague} (${hint.country} ${hint.name})`);
      continue;
    }

    const leagueId = league.league.id;
    const leagueName = league.league.name;

    let apiTeams: { id: number; name: string }[] = [];
    let usedSeason = "";
    for (const season of SEASONS) {
      console.log(`  squadre ${direttaLeague} stagione ${season}...`);
      const teamsData = await apiFetch(`/teams?league=${leagueId}&season=${season}`);
      await sleep(DELAY_MS);
      apiTeams = teamsData.response.map((t: any) => ({
        id: t.team.id,
        name: t.team.name,
      }));
      if (apiTeams.length > 0) {
        usedSeason = season;
        break;
      }
    }

    if (apiTeams.length === 0) {
      console.warn(`Nessuna squadra per ${direttaLeague} in nessuna stagione`);
      continue;
    }

    console.log(`${direttaLeague} -> API-Football ${leagueId} (${leagueName}), stagione ${usedSeason}, ${apiTeams.length} squadre`);
    leagueCache.set(direttaLeague, { leagueId, leagueName, teams: apiTeams });

    // Imposta il nome della lega per tutte le entrate di questa lega
    for (const entry of teams) {
      if (entry.direttaLeague === direttaLeague && entry.apifootballLeague !== null && entry.apifootballLeagueName === null) {
        entry.apifootballLeagueName = leagueName;
      }
    }

    let leagueMatched = 0;
    for (const entry of teams) {
      if (entry.direttaLeague !== direttaLeague) continue;
      if (entry.apifootball !== null && entry.apifootballTeamName !== null) continue;

      const normDirecta = normalize(entry.diretta);
      const best = apiTeams.find((t) => normalize(t.name) === normDirecta);

      if (best) {
        entry.apifootball = best.id;
        entry.apifootballTeamName = best.name;
        entry.apifootballLeague = leagueId;
        entry.apifootballLeagueName = leagueName;
        leagueMatched++;
        console.log(`  MATCH: ${entry.diretta} -> ${best.name} (${best.id})`);
      } else {
        console.log(`  NO MATCH: ${entry.diretta}`);
      }
    }

    await writeFile(TEAMS_PATH, JSON.stringify(teams, null, 2) + "\n");
    console.log(`  Salvato: ${leagueMatched}/${teams.filter((t) => t.direttaLeague === direttaLeague).length} squadre per ${direttaLeague}`);
  }

  const totalMapped = teams.filter((t) => t.apifootball !== null).length;
  const withNames = teams.filter((t) => t.apifootballTeamName !== null).length;
  console.log(`\nCompletato: ${totalMapped}/${teams.length} squadre con ID, ${withNames}/${teams.length} con nome squadra.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
