import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { upsertTeams, initTeamsRepo } from "../services/teams_repo.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEAMS_JSON_PATH = join(__dirname, "..", "res", "teams.json");

type TeamEntry = {
  diretta: string;
  apifootball: number | null;
  apifootballTeamName: string | null;
  apifootballLeague: number | null;
  country: string | null;
};

async function main() {
  console.log("Initializing teams repository...");
  initTeamsRepo();

  console.log(`Reading teams from ${TEAMS_JSON_PATH}...`);
  const raw = await readFile(TEAMS_JSON_PATH, "utf-8");
  const teams: TeamEntry[] = JSON.parse(raw);

  console.log(`Found ${teams.length} teams`);

  const teamsToUpsert = teams.map((t) => ({
    diretta_name: t.diretta,
    api_football_id: t.apifootball,
    api_football_name: t.apifootballTeamName,
    api_football_league_id: t.apifootballLeague,
    country: t.country ?? null,
  }));

  console.log("Upserting teams to Supabase...");
  const count = await upsertTeams(teamsToUpsert);

  console.log(`Successfully upserted ${count} teams`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});