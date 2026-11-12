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
  WIN_RATE_ENV,
  resetSignalState,
} from "../src/services/signals/index.ts";
import {
  resetMappingStore,
  createTeam,
  upsertLeagueLink,
} from "../src/mapping/repo.ts";
import { upsertScheduledFixtures, deleteAllScheduledFixtures } from "../src/services/scheduled_fixtures_repo.ts";

process.env["LOG_LEVEL"] = "silent";

// Forza il repository di mapping in memoria: in test non c'è Supabase
// raggiungibile (.env.local espone credenziali ma nessun endpoint).
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const M1_START = Math.floor(Date.now() / 1000) - 20 * 60;

const LIVE_FIXTURE = {
  fixture: { id: 1, date: new Date(M1_START * 1000).toISOString(), status: { short: "1H" } },
  league: { id: 78, name: "ITALIA: Serie A", country: "Italia" },
  teams: { home: { id: 100, name: "Inter" }, away: { id: 101, name: "Milan" } },
  goals: { home: 0, away: 0 },
};

const ODDS_RESPONSE = [
  {
    bookmakers: [
      {
        id: 1,
        name: "Book A",
        bets: [
          {
            id: 8,
            name: "Over / Under",
            values: [
              { value: "Over 0.5", odd: "1.8" },
              { value: "Under 0.5", odd: "2.0" },
            ],
          },
        ],
      },
    ],
  },
];

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
let oddsCalls = 0;
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
  if (target.includes("v3.football.api-sports.io")) {
    if (target.includes("/odds")) {
      oddsCalls += 1;
      return makeResponse(JSON.stringify({ response: ODDS_RESPONSE }));
    }
    return makeResponse(JSON.stringify({ response: [LIVE_FIXTURE] }));
  }
  if (target.includes("df_st_")) {
    statsCalls += 1;
    return statsFail ? makeResponse("boom", false, 500) : makeResponse(statsBody);
  }
  return makeResponse("{}");
}) as unknown as typeof fetch;

const silentHooks = () => ({ log: () => {} });

let homeTeamId = "";
let awayTeamId = "";

beforeEach(async () => {
  globalThis.fetch = fixtureFetch;
  resetMappingStore();
  resetSignalState();
  await deleteAllScheduledFixtures();
  statsCalls = 0;
  oddsCalls = 0;
  statsFail = false;
  statsBody = STATS_FIXTURE;
  telegramCalls = 0;
  telegramBodies = [];
  telegramFail = false;
  const home = await createTeam("Inter", "Italia");
  const away = await createTeam("Milan", "Italia");
  homeTeamId = home.id;
  awayTeamId = away.id;
  await upsertLeagueLink({ apiFootballLeagueId: 78, direttaTournamentId: "T1", name: "ITALIA: Serie A" });
});

after(() => {
  globalThis.fetch = originalFetch;
});

test("strategy enriches live fixtures whose league is monitored via league_links", async () => {
  await upsertScheduledFixtures([{
    fixture_id: 1,
    match_id: "m1",
    api_football_league_id: 78,
    api_football_league_name: "ITALIA: Serie A",
    home_team: "Inter",
    away_team: "Milan",
    kickoff_time: new Date(M1_START * 1000).toISOString(),
    begin_monitoring_time: new Date((M1_START - 60) * 1000).toISOString(),
    end_monitoring_time: new Date((M1_START + 120) * 1000).toISOString(),
  }]);
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
  assert.equal(oddsCalls, 0); // no alert => no odds lookup
});

test("strategy skips live fixtures not monitored by league_links", async () => {
  await resetMappingStore();
  const home = await createTeam("Inter", "Italia");
  const away = await createTeam("Milan", "Italia");
  await upsertScheduledFixtures([{
    fixture_id: 1,
    match_id: "m1",
    api_football_league_id: 78,
    api_football_league_name: "ITALIA: Serie A",
    home_team: "Inter",
    away_team: "Milan",
    kickoff_time: new Date().toISOString(),
    begin_monitoring_time: new Date().toISOString(),
    end_monitoring_time: new Date().toISOString(),
  }]);

  const result = await runLiveMatchesStrategy({}, silentHooks());

  assert.equal(result.matches, 0);
  assert.equal(result.enriched, 0);
  assert.equal(result.results.length, 0);
});

test("strategy skips live fixtures without a diretta link", async () => {
  await resetMappingStore();
  await upsertLeagueLink({ apiFootballLeagueId: 78, direttaTournamentId: "T1", name: "ITALIA: Serie A" });
  const home = await createTeam("Inter", "Italia");
  const away = await createTeam("Milan", "Italia");

  const result = await runLiveMatchesStrategy({}, silentHooks());

  assert.equal(result.matches, 0);
  assert.equal(result.enriched, 0);
});

test("strategy records a per-match failure without throwing", async () => {
  statsFail = true;
  await upsertScheduledFixtures([{
    fixture_id: 1,
    match_id: "m1",
    api_football_league_id: 78,
    api_football_league_name: "ITALIA: Serie A",
    home_team: "Inter",
    away_team: "Milan",
    kickoff_time: new Date(M1_START * 1000).toISOString(),
    begin_monitoring_time: new Date((M1_START - 60) * 1000).toISOString(),
    end_monitoring_time: new Date((M1_START + 120) * 1000).toISOString(),
  }]);
  const result = await runLiveMatchesStrategy({}, silentHooks());

  assert.equal(result.matches, 1);
  assert.equal(result.enriched, 0);
  assert.equal(result.failures, 1);
  assert.equal(result.results[0]!.statistics, null);
  assert.match(result.results[0]!.error ?? "", /HTTP 500/);
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

test("strategy dispatches signal alerts through Telegram with live odds from API-Football", async () => {
  const savedEnv = {
    [TELEGRAM_BOT_TOKEN_ENV]: process.env.TELEGRAM_BOT_TOKEN,
    [TELEGRAM_CHAT_ID_ENV]: process.env.TELEGRAM_CHAT_ID,
    [WIN_RATE_ENV]: process.env[WIN_RATE_ENV],
  };
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "-10042";
  delete process.env[WIN_RATE_ENV];
  statsBody = ALERT_STATS_FIXTURE;
  await upsertScheduledFixtures([{
    fixture_id: 1,
    match_id: "m1",
    api_football_league_id: 78,
    api_football_league_name: "ITALIA: Serie A",
    home_team: "Inter",
    away_team: "Milan",
    kickoff_time: new Date(M1_START * 1000).toISOString(),
    begin_monitoring_time: new Date((M1_START - 60) * 1000).toISOString(),
    end_monitoring_time: new Date((M1_START + 120) * 1000).toISOString(),
  }]);
  try {
    const result = await runLiveMatchesStrategy({}, silentHooks());

    assert.equal(result.failures, 0);
    assert.equal(result.results[0]!.alerts.length, 1);
    assert.equal(result.results[0]!.alerts[0]!.odds, 1.8);
    assert.equal(oddsCalls, 1);
    assert.equal(telegramCalls, 1);
    const minute = Math.trunc((Date.now() / 1000 - M1_START) / 60) + 1;
    assert.deepEqual(telegramBodies[0], {
      chat_id: "-10042",
      text: [
        "⚽ Alert Goal Over 0.5 HT",
        "🏆 Serie A 🇮🇹",
        `💹 Live, Win Rate: ➡️ 80%`,
        "💶 Quota live: 1.80",
        `⏱ ${minute}°`,
        "🎽 Inter vs Milan [0-0]",
        `ℹ️ Tocchi area: 30`,
        `ℹ️ Rapporto: ${(30 / minute).toFixed(2)}`,
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
    [WIN_RATE_ENV]: process.env[WIN_RATE_ENV],
  };
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "-10042";
  delete process.env[WIN_RATE_ENV];
  statsBody = ALERT_STATS_FIXTURE;
  telegramFail = true;
  await upsertScheduledFixtures([{
    fixture_id: 1,
    match_id: "m1",
    api_football_league_id: 78,
    api_football_league_name: "ITALIA: Serie A",
    home_team: "Inter",
    away_team: "Milan",
    kickoff_time: new Date(M1_START * 1000).toISOString(),
    begin_monitoring_time: new Date((M1_START - 60) * 1000).toISOString(),
    end_monitoring_time: new Date((M1_START + 120) * 1000).toISOString(),
  }]);
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
