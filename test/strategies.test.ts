import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAJOR_LEAGUES,
  LIVE_MATCHES_STRATEGY,
  configuredMajorLeagues,
  isMajorLeague,
  liveMatchesStrategy,
  runLiveMatchesStrategy,
} from "../src/services/strategies/index.ts";
import {
  TELEGRAM_BOT_TOKEN_ENV,
  TELEGRAM_CHAT_ID_ENV,
  TOUCHES_ENV,
  resetSignalState,
} from "../src/services/signals/index.ts";

const FIXTURE = [
  "ZA\u00f7ITALIA: Serie A\u00acZY\u00f7Italia\u00acZEE\u00f7COuk57Ci\u00acZC\u00f71\u00acZL\u00f7/calcio/italia/serie-a/",
  "AA\u00f7m1\u00acAB\u00f72\u00acAC\u00f712\u00acAD\u00f71700000000\u00acAE\u00f7Inter\u00acAF\u00f7Milan\u00acAG\u00f71\u00acAH\u00f70\u00acAI\u00f7y\u00acAO\u00f71700000000",
  "AA\u00f7m2\u00acAB\u00f73\u00acAC\u00f73\u00acAD\u00f71700001000\u00acAE\u00f7Roma\u00acAF\u00f7Lazio\u00acAG\u00f72\u00acAH\u00f71",
  "ZA\u00f7ALBANIA: Abissnet Superiore\u00acZY\u00f7Albania\u00acZEE\u00f7nwPDBpVc\u00acZC\u00f75\u00acZL\u00f7/calcio/albania/",
  "AA\u00f7m3\u00acAB\u00f72\u00acAC\u00f712\u00acAD\u00f71700000000\u00acAE\u00f7Tirana\u00acAF\u00f7Partizani\u00acAG\u00f70\u00acAH\u00f70\u00acAI\u00f7y\u00acAO\u00f71700000000",
].join("~");

const STATS_FIXTURE = [
  "SE\u00f7Partita",
  "SF\u00f7Statistiche Top",
  "SD\u00f712\u00acSG\u00f7Possesso palla\u00acSH\u00f755%\u00acSI\u00f745%",
].join("~");

const ALERT_STATS_FIXTURE = [
  "SE\u00f71 tempo",
  "SF\u00f7Attacco",
  "SD\u00f799\u00acSG\u00f7Palloni toccati nell'area avversaria\u00acSH\u00f720\u00acSI\u00f710",
].join("~");

const originalFetch = globalThis.fetch;
let statsCalls = 0;
let statsFail = false;
let statsBody = STATS_FIXTURE;
let telegramCalls = 0;
let telegramBodies: { chat_id?: string; text?: string }[] = [];
let telegramFail = false;

const makeResponse = (body: string, ok = true, status = 200): Response => {
  return { ok, status, text: async () => body } as unknown as Response;
}

const fixtureFetch = (async (url: string, init?: RequestInit) => {
  const target = String(url);
  if (target.includes("api.telegram.org")) {
    telegramCalls += 1;
    telegramBodies.push(init?.body ? JSON.parse(String(init.body)) : {});
    return telegramFail ? makeResponse("boom", false, 500) : makeResponse("{}");
  }
  if (target.includes("df_st_")) {
    statsCalls += 1;
    return statsFail ? makeResponse("boom", false, 500) : makeResponse(statsBody);
  }
  return makeResponse(FIXTURE);
}) as unknown as typeof fetch;

const silentHooks = (allowlist: string[] = [...DEFAULT_MAJOR_LEAGUES]) => ({
  allowlist,
  log: () => {},
});

beforeEach(() => {
  globalThis.fetch = fixtureFetch;
  statsCalls = 0;
  statsFail = false;
  statsBody = STATS_FIXTURE;
  telegramCalls = 0;
  telegramBodies = [];
  telegramFail = false;
  resetSignalState();
});

after(() => {
  globalThis.fetch = originalFetch;
});

test("strategy only enriches live matches from major leagues", async () => {
  const result = await runLiveMatchesStrategy({}, silentHooks());

  assert.equal(result.name, LIVE_MATCHES_STRATEGY);
  assert.equal(result.matches, 1);
  assert.equal(result.enriched, 1);
  assert.equal(result.failures, 0);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]!.matchId, "m1");
  assert.equal(result.results[0]!.home, "Inter");
  assert.equal(result.results[0]!.away, "Milan");
  assert.equal(result.results[0]!.error, null);
  assert.equal(result.results[0]!.statistics?.all["top"]?.length, 1);
  assert.equal(statsCalls, 1);
});

test("strategy prints statistics through the log hook", async () => {
  const logged: string[] = [];
  const result = await runLiveMatchesStrategy(
    {},
    { allowlist: [...DEFAULT_MAJOR_LEAGUES], log: (match) => { logged.push(match.id); } },
  );

  assert.deepEqual(logged, ["m1"]);
  assert.equal(result.enriched, 1);
});

test("strategy records a per-match failure without throwing", async () => {
  statsFail = true;
  const result = await runLiveMatchesStrategy({}, silentHooks());

  assert.equal(result.matches, 1);
  assert.equal(result.enriched, 0);
  assert.equal(result.failures, 1);
  assert.equal(result.results[0]!.statistics, null);
  assert.match(result.results[0]!.error ?? "", /HTTP 500/);
});

test("strategy respects a narrowed allowlist", async () => {
  const result = await runLiveMatchesStrategy({}, silentHooks(["nwPDBpVc"]));

  assert.equal(result.matches, 1);
  assert.equal(result.results[0]!.matchId, "m3");
});

test("configuredMajorLeagues defaults and reads the env allowlist", () => {
  assert.deepEqual(configuredMajorLeagues({}), [...DEFAULT_MAJOR_LEAGUES]);
  assert.deepEqual(configuredMajorLeagues({ MONITOR_MAJOR_LEAGUES: "" }), [...DEFAULT_MAJOR_LEAGUES]);
  assert.deepEqual(configuredMajorLeagues({ MONITOR_MAJOR_LEAGUES: "ITALIA: Serie A, COuk57Ci ," }), [
    "ITALIA: Serie A",
    "COuk57Ci",
  ]);
});

test("isMajorLeague matches by full tournament name or id, not by loose name", () => {
  const match = { id: "m1", tournament: "ITALIA: Serie A", tournament_id: "COuk57Ci" };
  assert.equal(isMajorLeague(match, ["ITALIA: Serie A"]), true);
  assert.equal(isMajorLeague(match, ["COuk57Ci"]), true);
  assert.equal(isMajorLeague(match, ["ALGERIA: Ligue 1"]), false);
  assert.equal(isMajorLeague(match, ["Serie A"]), false);
});

test("default major leagues cover the top competitions with diretta names", () => {
  const defaults = [...DEFAULT_MAJOR_LEAGUES];
  for (const entry of [
    "ITALIA: Serie A",
    "ITALIA: Serie B",
    "INGHILTERRA: Premier League",
    "INGHILTERRA: Championship",
    "GERMANIA: Bundesliga",
    "AUSTRIA: Bundesliga",
    "GERMANIA: 2. Bundesliga",
    "SPAGNA: LaLiga",
    "SPAGNA: LaLiga2",
    "FRANCIA: Ligue 1",
    "OLANDA: Eredivisie",
    "PORTOGALLO: Liga Portugal",
    "ROMANIA: Superliga",
    "SERBIA: Super Liga",
    "DANIMARCA: Superliga",
    "TURCHIA: 1. Lig",
    "EUROPA: Champions League",
    "EUROPA: Europa League",
  ]) {
    assert.ok(defaults.includes(entry), `missing ${entry}`);
  }
  // Loose generic names are never allowlisted: matching stays exact on the full
  // diretta name to avoid collisions (Algeria Ligue 1, Greece Super League, ...).
  assert.ok(!defaults.includes("Ligue 1"));
  assert.ok(!defaults.includes("Serie A"));
  assert.ok(!defaults.includes("Super League"));
});

test("strategy is exposed as a named Strategy", () => {
  assert.equal(liveMatchesStrategy.name, LIVE_MATCHES_STRATEGY);
  assert.equal(typeof liveMatchesStrategy.run, "function");
});

test("strategy dispatches signal alerts through Telegram", async () => {
  const savedEnv = {
    [TELEGRAM_BOT_TOKEN_ENV]: process.env.TELEGRAM_BOT_TOKEN,
    [TELEGRAM_CHAT_ID_ENV]: process.env.TELEGRAM_CHAT_ID,
    [TOUCHES_ENV]: process.env.TOUCHES_ENV,
  };
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "-10042";
  delete process.env[TOUCHES_ENV];
  statsBody = ALERT_STATS_FIXTURE;
  try {
    const result = await runLiveMatchesStrategy({}, silentHooks());

    assert.equal(result.failures, 0);
    assert.equal(result.results[0]!.alerts.length, 1);
    assert.equal(telegramCalls, 1);
    assert.deepEqual(telegramBodies[0], {
      chat_id: "-10042",
      text: [
        "⚽ Alert goal Over 0.5 HT",
        "🏆 ITALIA: Serie A 🇮🇹",
        "⏱ 45'",
        "🎽 Inter vs Milan [1-0]",
      ].join("\n"),
    });
  } finally {
    restoreEnv(savedEnv);
  }
});

test("strategy does not fail the match when the Telegram dispatch errors", async () => {
  const savedEnv = {
    [TELEGRAM_BOT_TOKEN_ENV]: process.env.TELEGRAM_BOT_TOKEN,
    [TELEGRAM_CHAT_ID_ENV]: process.env.TELEGRAM_CHAT_ID,
    [TOUCHES_ENV]: process.env.TOUCHES_ENV,
  };
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "-10042";
  delete process.env[TOUCHES_ENV];
  statsBody = ALERT_STATS_FIXTURE;
  telegramFail = true;
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await runLiveMatchesStrategy({}, silentHooks());

    assert.equal(result.failures, 0);
    assert.equal(result.enriched, 1);
    assert.equal(result.results[0]!.error, null);
    assert.ok(result.results[0]!.statistics);
    assert.equal(result.results[0]!.alerts.length, 1);
    assert.equal(telegramCalls, 1);
  } finally {
    console.error = originalError;
    restoreEnv(savedEnv);
  }
});

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
