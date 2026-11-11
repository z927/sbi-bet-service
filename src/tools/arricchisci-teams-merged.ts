import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

const envFile = [".env.local", ".env"].find((f) => existsSync(f));
if (envFile) dotenvConfig({ path: envFile });

const API_BASE = "https://v3.football.api-sports.io";
const API_KEY =
  process.env.API_FOOTBALL_KEY ||
  process.env.APIFOOTBALL_KEY ||
  process.env.RAPIDAPI_KEY;

if (!API_KEY) {
  console.error("Imposta API_FOOTBALL_KEY (o APIFOOTBALL_KEY / RAPIDAPI_KEY)");
  process.exit(1);
}

const TEAMS_PATH = "src/res/teams_merged.json";
const SEASONS = ["2026", "2025", "2024"];
const DELAY_MS = 2500;
const SIMILARITY_THRESHOLD = 0.70;
const SECOND_THRESHOLD = 0.55;

type MergedEntry = {
  diretta: string;
  apifootball: number | null;
  apifootballTeamName: string | null;
  apifootballLeague: number | null;
  apifootballLeagueName: string | null;
  direttaLeague: string | null;
};

type LeagueHint = { country: string; name: string };

const LEAGUE_MAP: Record<string, LeagueHint> = {
  "INGHILTERRA: Premier League": { country: "England", name: "Premier League" },
  "INGHILTERRA: Championship": { country: "England", name: "Championship" },
  "INGHILTERRA: League One": { country: "England", name: "League One" },
  "ITALIA: Serie A": { country: "Italy", name: "Serie A" },
  "ITALIA: Serie B": { country: "Italy", name: "Serie B" },
  "SPAGNA: LaLiga": { country: "Spain", name: "La Liga" },
  "SPAGNA: LaLiga 2": { country: "Spain", name: "Segunda División" },
  "GERMANIA: Bundesliga": { country: "Germany", name: "Bundesliga" },
  "GERMANIA: 2. Bundesliga": { country: "Germany", name: "2. Bundesliga" },
  "FRANCIA: Ligue 1": { country: "France", name: "Ligue 1" },
  "FRANCIA: Ligue 2": { country: "France", name: "Ligue 2" },

  "OLANDA: Eredivisie": { country: "Netherlands", name: "Eredivisie" },
  "OLANDA: Eerste Divisie": { country: "Netherlands", name: "Eerste Divisie" },
  "AUSTRIA: Bundesliga": { country: "Austria", name: "Bundesliga" },
  "BELGIO: Jupiler League": { country: "Belgium", name: "Jupiler Pro League" },
  "BELGIO: Challenger Pro League": { country: "Belgium", name: "Challenger Pro League" },
  "DANIMARCA: Superliga": { country: "Denmark", name: "Superliga" },
  "PORTOGALLO: Liga Portugal": { country: "Portugal", name: "Primeira Liga" },
  "PORTOGALLO: Liga Portugal 2": { country: "Portugal", name: "Segunda Liga" },
  "REPUBBLICA CECA: 1. Liga": { country: "Czech-Republic", name: "Czech Liga" },
  "ROMANIA: Superliga": { country: "Romania", name: "Liga I" },
  "SCOZIA: Premiership": { country: "Scotland", name: "Premiership" },
  "SERBIA: Super Liga": { country: "Serbia", name: "Super Liga" },
  "SVIZZERA: Super League": { country: "Switzerland", name: "Super League" },
  "TURCHIA: Super Lig": { country: "Turkey", name: "Süper Lig" },
  "IRLANDA: Premier Division": { country: "Ireland", name: "Premier Division" },
  "EUROPA: Champions League": { country: "World", name: "UEFA Champions League" },
  "EUROPA: Europa League": { country: "World", name: "UEFA Europa League" },
  "EUROPA: Conference League": { country: "World", name: "UEFA Europa Conference League" },
};

const STOP_WORDS = [
  "fc", "sc", "ac", "as", "us", "cd", "ud", "sd", "cf", "cdf", "real", "atletico",
  "atl", "sporting", "cp", "psg", "olympique", "om", "girondins", "borussia",
  "eintracht", "vfl", "tsv", "1.", "sv", "bvb", "rbs", "rbl", "ssc", "calcio",
  "genoa", "roma", "lazio", "napoli", "inter", "milan", "juventus", "torino",
  "atalanta", "fiorentina", "verona", "monza", "lecce", "cagliari", "parma",
  "como", "empoli", "udinese", "bologna", "sassuolo",   "salernitana", "frosinone",
  "u23", "u21", "u19", "u18",
];

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalize(s: string): string {
  let t = stripAccents(s.toLowerCase());
  t = t.replace(/[^\w\s]/g, " ");
  const tokens = t
    .split(/\s+/)
    .filter((tok) => tok !== "" && !STOP_WORDS.includes(tok));
  return tokens.join(" ").trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev: number[] = new Array(n + 1);
  const curr: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a[i - 1];
    for (let j = 1; j <= n; j++) {
      const cost = ca === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    const tmp = prev;
    prev.length = 0;
    prev.push(...curr);
    curr.length = 0;
    curr.push(...tmp);
  }
  return prev[n] ?? 0;
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === "" || nb === "") return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiFetch(path: string, retries = 6): Promise<any> {
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
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) {
      throw new Error(`API-Football ${path}: ${res.status}`);
    }
    return res.json();
  }
  throw new Error(`API-Football ${path}: rate limit persistente`);
}

async function findLeague(leagues: any[], hint: LeagueHint) {
  const exact = leagues.find(
    (l) =>
      l.country?.name?.toLowerCase() === hint.country.toLowerCase() &&
      l.league?.name?.toLowerCase() === hint.name.toLowerCase()
  );
  if (exact) return exact;
  return leagues.find(
    (l) =>
      l.country?.name?.toLowerCase() === hint.country.toLowerCase() &&
      (l.league?.name?.toLowerCase().includes(hint.name.toLowerCase()) ||
        hint.name.toLowerCase().includes(l.league?.name?.toLowerCase() ?? ""))
  );
}

async function main() {
  const raw = await readFile(TEAMS_PATH, "utf-8");
  const teams: MergedEntry[] = JSON.parse(raw);

  const senzaAF = teams.filter(
    (t) => t.apifootball === null || t.apifootball === undefined
  );
  console.log(
    `Totale squadre: ${teams.length}, senza API-Football: ${senzaAF.length}`
  );

  const legheSenzaAF = [...new Set(senzaAF.map((t) => t.direttaLeague))];
  console.log(`Leghe con squadre senza apifootball: ${legheSenzaAF.length}`);

  const leaguesData = await apiFetch("/leagues");
  await sleep(DELAY_MS);
  const leagues: any[] = leaguesData.response;

  let totaleMatch = 0;
  let totaleNoMatch = 0;
  let totLegaManca = 0;

  for (const direttaLeague of legheSenzaAF) {
    if (!direttaLeague) continue;
    const hint = LEAGUE_MAP[direttaLeague];
    if (!hint) {
      console.warn(`Nessun mapping per ${direttaLeague}, salto`);
      totLegaManca++;
      continue;
    }

    const squadreSenzaAF = teams.filter(
      (t) =>
        t.direttaLeague === direttaLeague &&
        (t.apifootball === null || t.apifootball === undefined)
    );
    if (squadreSenzaAF.length === 0) continue;

    const league = await findLeague(leagues, hint);
    if (!league) {
      console.warn(`Lega API-Football non trovata per ${direttaLeague}`);
      continue;
    }

    const leagueId = league.league.id;
    const leagueName = league.league.name;

    let apiTeams: { id: number; name: string }[] = [];
    let usedSeason = "";
    for (const season of SEASONS) {
      console.log(`  squadre ${direttaLeague} stagione ${season}...`);
      const teamsData = await apiFetch(
        `/teams?league=${leagueId}&season=${season}`
      );
      await sleep(DELAY_MS);
      apiTeams = teamsData.response.map(
        (t: any) => ({ id: t.team.id, name: t.team.name })
      );
      if (apiTeams.length > 0) {
        usedSeason = season;
        break;
      }
    }

    if (apiTeams.length === 0) {
      console.warn(`Nessuna squadra per ${direttaLeague}`);
      continue;
    }

    console.log(
      `${direttaLeague} -> API-Football ${leagueId} (${leagueName}), stagione ${usedSeason}, ${apiTeams.length} squadre, da matchare: ${squadreSenzaAF.length}`
    );

    for (const entry of squadreSenzaAF) {
      let best: { id: number; name: string; sim: number } | null = null;
      for (const cand of apiTeams) {
        const sim = similarity(entry.diretta, cand.name);
        if (sim >= SIMILARITY_THRESHOLD && (!best || sim > best.sim)) {
          best = { id: cand.id, name: cand.name, sim };
        }
      }
      if (!best) {
        for (const cand of apiTeams) {
          const sim = similarity(entry.diretta, cand.name);
          if (sim >= SECOND_THRESHOLD && (!best || sim > best.sim)) {
            best = { id: cand.id, name: cand.name, sim };
          }
        }
      }
      if (best) {
        entry.apifootball = best.id;
        entry.apifootballTeamName = best.name;
        entry.apifootballLeague = leagueId;
        entry.apifootballLeagueName = leagueName;
        totaleMatch++;
        console.log(
          `  FUZZY MATCH: ${entry.diretta} -> ${best.name} (${best.id}) sim=${best.sim.toFixed(2)}`
        );
      } else {
        totaleNoMatch++;
        console.log(`  NO FUZZY MATCH: ${entry.diretta}`);
      }
    }

    await writeFile(TEAMS_PATH, JSON.stringify(teams, null, 2) + "\n");
  }

  const senzaLega = teams.filter(
    (t) =>
      (t.apifootball !== null && t.apifootball !== undefined) &&
      (t.apifootballLeague === null || t.apifootballLeague === undefined)
  );
  console.log(
    `Squadre con apifootball ma senza lega: ${senzaLega.length}`
  );
  for (const entry of senzaLega) {
    const hint = LEAGUE_MAP[entry.direttaLeague ?? ""];
    if (!hint) {
      console.warn(`Nessun mapping lega per ${entry.direttaLeague}`);
      continue;
    }
    const league = await findLeague(leagues, hint);
    if (league) {
      entry.apifootballLeague = league.league.id;
      entry.apifootballLeagueName = league.league.name;
    }
  }

  await writeFile(TEAMS_PATH, JSON.stringify(teams, null, 2) + "\n");

  const residuo = teams.filter(
    (t) => t.apifootball === null || t.apifootball === undefined
  ).length;
  const residuoLega = teams.filter(
    (t) =>
      (t.apifootball !== null && t.apifootball !== undefined) &&
      (t.apifootballLeague === null || t.apifootballLeague === undefined)
  ).length;
  console.log(
    `\nCompletato fuzzy: ${totaleMatch} match, ${totaleNoMatch} no match, ${residuo} ancora senza apifootball, ${residuoLega} ancora senza lega`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
