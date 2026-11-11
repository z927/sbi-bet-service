import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { listMatches } from "../clients/diretta/matches.ts";

const envFile = [".env.local", ".env"].find((f) => existsSync(f));
if (envFile) dotenvConfig({ path: envFile });

const LEAGUES_PATH = "src/res/leagues.json";
const SIMILARITY_THRESHOLD = 0.75;

type LeagueEntry = {
  leagueId: number;
  tournamentId: number | string;
  name: string;
  type: string;
  logo: string;
  countryName: string;
  countryFlag: string | null;
};

type DirettaTournament = {
  tournamentId: string;
  name: string;
  country: string;
};

const LEAGUE_STOP_WORDS = [
  "cup", "coppa", "liga", "league", "serie", "primera", "segunda", "super",
  "bundesliga", "ligue", "premier", "championship", "eredivisie", "primeira",
  "premiership", "coupe", "dfb", "pokal", "knvb", "beker", "italia", "spagna",
  "germania", "francia", "inghilterra", "olanda", "portogallo", "belgio",
  "austria", "svizzera", "scozia", "serbia", "romania", "danimarca", "irlanda",
  "ceca", "repubblica", "mondo", "europa", "uefa", "champions", "conference",
  "nations", "world", "qualification", "division", "republic",
];

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalize(s: string): string {
  let t = stripAccents(s.toLowerCase());
  t = t.replace(/[^\w\s]/g, " ");
  const tokens = t
    .split(/\s+/)
    .filter((tok) => tok !== "" && !LEAGUE_STOP_WORDS.includes(tok));
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

function findBestTournament(
  lega: LeagueEntry,
  tornei: DirettaTournament[],
): { tournamentId: string; name: string; sim: number } | null {
  let best: { tournamentId: string; name: string; sim: number } | null = null;
  const legaNorm = normalize(lega.name);
  const legaCountry = normalize(lega.countryName);

  for (const t of tornei) {
    const tNorm = normalize(t.name);
    const tCountry = normalize(t.country);
    let sim = similarity(legaNorm, tNorm);

    if (legaCountry && tCountry && legaCountry === tCountry) {
      sim = Math.min(1, sim + 0.1);
    }

    if (sim >= SIMILARITY_THRESHOLD && (!best || sim > best.sim)) {
      best = { tournamentId: t.tournamentId, name: t.name, sim };
    }
  }

  return best;
}

async function main() {
  const raw = await readFile(LEAGUES_PATH, "utf-8");
  const leagues: LeagueEntry[] = JSON.parse(raw);

  console.log(`Totale leghe: ${leagues.length}`);

  const matches = await listMatches(1);
  const direttaTournamenti = new Map<string, DirettaTournament>();
  for (const m of matches) {
    const id = (m.tournament_id ?? "").trim();
    const name = (m.tournament ?? "").trim();
    const country = (m.country ?? "").trim();
    if (!id || !name) continue;
    if (!direttaTournamenti.has(id)) {
      direttaTournamenti.set(id, { tournamentId: id, name, country });
    }
  }

  const tornei = [...direttaTournamenti.values()];
  console.log(`Tornei Diretta trovati: ${tornei.length}`);

  let aggiornate = 0;
  let nonTrovate = 0;

  for (const lega of leagues) {
    const best = findBestTournament(lega, tornei);
    if (best) {
      const current = String(lega.tournamentId);
      if (current !== best.tournamentId) {
        console.log(
          `  ${lega.name} (${lega.countryName}): ${current} -> ${best.tournamentId} (${best.name}) sim=${best.sim.toFixed(2)}`,
        );
        lega.tournamentId = best.tournamentId;
        aggiornate++;
      }
    } else {
      nonTrovate++;
      console.log(
        `  NO MATCH: ${lega.name} (${lega.countryName}) attuale: ${lega.tournamentId}`,
      );
    }
  }

  await writeFile(LEAGUES_PATH, JSON.stringify(leagues, null, 2) + "\n");

  console.log(
    `\nCompletato: ${aggiornate} aggiornate, ${nonTrovate} senza match Diretta`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
