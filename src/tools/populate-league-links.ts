import { readFile } from "node:fs/promises";
import { upsertLeagueLink } from "../mapping/repo.ts";

const LEAGUES_PATH = "src/res/leagues.json";

type LeagueEntry = {
  leagueId: number;
  direttaLeagueId: string;
  name: string;
  type: string;
  logo: string;
  countryName: string;
  countryFlag: string | null;
};

async function main() {
  console.log(`Reading leagues from ${LEAGUES_PATH}...`);
  const raw = await readFile(LEAGUES_PATH, "utf-8");
  const leagues: LeagueEntry[] = JSON.parse(raw);

  console.log(`Found ${leagues.length} leagues`);

  let upserted = 0;
  for (const lega of leagues) {
    await upsertLeagueLink({
      apiFootballLeagueId: lega.leagueId,
      direttaTournamentId: lega.direttaLeagueId,
      name: lega.name,
    });
    upserted++;
    console.log(`  ${lega.leagueId} (${lega.name}) -> diretta ${lega.direttaLeagueId}`);
  }

  console.log(`Successfully upserted ${upserted} league links`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
