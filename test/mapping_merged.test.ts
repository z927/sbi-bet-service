import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as service from "../src/mapping/service.ts";
import * as repo from "../src/mapping/repo.ts";
import type { MergedTeamEntry } from "../src/mapping/models.ts";

process.env["LOG_LEVEL"] = "silent";
process.env["SUPABASE_URL"] = "";
process.env["SUPABASE_SERVICE_ROLE_KEY"] = "";

const FIXTURE: MergedTeamEntry[] = [
  {
    diretta: "Arsenal",
    apifootball: 42,
    apifootballLeague: 39,
    direttaLeague: "INGHILTERRA: Premier League",
    apifootballTeamName: "Arsenal",
    apifootballLeagueName: "Premier League",
  },
  {
    diretta: "Chelsea",
    apifootball: 49,
    apifootballLeague: 39,
    direttaLeague: "INGHILTERRA: Premier League",
    apifootballTeamName: "Chelsea",
    apifootballLeagueName: "Premier League",
  },
  {
    diretta: "SenzaMappatura",
    apifootball: null,
    apifootballLeague: null,
    direttaLeague: "INGHILTERRA: Premier League",
    apifootballTeamName: null,
    apifootballLeagueName: null,
  },
];

let dir = "";

beforeEach(() => {
  repo.resetMappingStore();
  dir = mkdtempSync(join(tmpdir(), "sbi-merged-"));
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const writeFixture = (entries = FIXTURE): string => {
  const path = join(dir, "teams_merged.json");
  writeFileSync(path, JSON.stringify(entries));
  return path;
};

test("syncTeamsFromMergedFile crea team e mapping da teams_merged.json", async () => {
  const path = writeFixture();
  const report = await service.syncTeamsFromMergedFile({ path, dryRun: false });

  assert.equal(report.seen, 2);
  assert.equal(report.skipped, 1);
  assert.equal(report.created, 2);
  assert.equal(report.mapped, 2);
  assert.equal(report.errors.length, 0);

  const mappings = await repo.listMappings();
  assert.equal(mappings.length, 2);
  const arsenal = mappings.find((m) => m.providerTeamId === "42");
  assert.ok(arsenal);
  assert.equal(arsenal.status, "confirmed");
  assert.equal(arsenal.source, "id");
  assert.equal(arsenal.rawName, "Arsenal");
});

test("syncTeamsFromMergedFile dry-run non persiste nulla", async () => {
  const path = writeFixture();
  const report = await service.syncTeamsFromMergedFile({ path, dryRun: true });

  assert.equal(report.seen, 2);
  assert.equal(report.created, 2);
  assert.equal(report.mapped, 0);

  const mappings = await repo.listMappings();
  assert.equal(mappings.length, 0);
});

test("syncTeamsFromMergedFile e idempotente: non ricrea team esistenti", async () => {
  const path = writeFixture();
  const first = await service.syncTeamsFromMergedFile({ path, dryRun: false });
  assert.equal(first.created, 2);
  assert.equal(first.mapped, 2);

  const second = await service.syncTeamsFromMergedFile({ path, dryRun: false });
  assert.equal(second.seen, 2);
  assert.equal(second.created, 0);
  assert.equal(second.mapped, 2);

  const mappings = await repo.listMappings();
  assert.equal(mappings.length, 2);
});
