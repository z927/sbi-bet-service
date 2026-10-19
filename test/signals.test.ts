import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TOUCHES_THRESHOLD,
  FIRST_HALF_WINDOW,
  GOAL_OVER_FT_TEXT,
  GOAL_OVER_HT_TEXT,
  GOAL_OVER_SIGNAL,
  SECOND_HALF_WINDOW,
  TELEGRAM_BOT_TOKEN_ENV,
  TELEGRAM_CHAT_ID_ENV,
  TOUCH_RATIO_SIGNAL,
  TOUCHES_ENV,
  WIN_RATE_ENV,
  countryFlag,
  dispatchAlerts,
  evaluateSignals,
  firstHalfMinutes,
  getTelegramConfig,
  getWinRate,
  goalOverSignal,
  matchMinute,
  matchPeriod,
  resetSignalState,
  sendTelegram,
  touchRatioSignal,
  type Alert,
  type Signal,
} from "../src/services/signals/index.ts";
import type { Match, Statistics } from "../src/scraper/models.ts";

const makeAlert = (overrides: Partial<Alert> = {}): Alert => ({
  rule: "test-rule",
  matchId: "m1",
  home: "Inter",
  away: "Milan",
  minute: 23,
  value: 0.5333,
  threshold: 0.4,
  text: "Alert over 0.5 HT!",
  tournament: "Serie A",
  country: "Italia",
  homeScore: 1,
  awayScore: 0,
  touches: 30,
  ...overrides,
});

const signalMatch = (overrides: Partial<Match> = {}): Match => ({
  id: "m1",
  home: "Inter",
  away: "Milan",
  tournament: "Serie A",
  country: "Italia",
  home_score: 1,
  away_score: 0,
  stage_id: 12,
  stage_start: 1700000000,
  ...overrides,
});

const goalMatch = (overrides: Partial<Match> = {}): Match => ({
  id: "g1",
  home: "Inter",
  away: "Milan",
  tournament: "Serie A",
  country: "Italia",
  home_score: 0,
  away_score: 0,
  stage_id: 12,
  stage_start: Math.floor(Date.now() / 1000) - 14 * 60,
  ...overrides,
});

const touchStats = (home: string, away: string): Statistics => ({
  all: {},
  first_half: {
    attack: [{ id: 1, name: "Palloni toccati nell'area avversaria", home, away }],
  },
  second_half: {},
});

const makeResponse = (body: string, ok = true, status = 200): Response => {
  return { ok, status, text: async () => body } as unknown as Response;
}

const originalFetch = globalThis.fetch;
const savedEnv: Record<string, string | undefined> = {};

const captureEnv = (...keys: string[]): void => {
  for (const key of keys) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
}

let captured: { url: string; init?: RequestInit } | null = null;
let nextResponse: Response = makeResponse("{}");

const mockFetch = (async (url: string, init?: RequestInit) => {
  captured = { url: String(url), init };
  return nextResponse;
}) as unknown as typeof fetch;

beforeEach(() => {
  globalThis.fetch = mockFetch;
  captured = null;
  nextResponse = makeResponse("{}");
  captureEnv(TELEGRAM_BOT_TOKEN_ENV, TELEGRAM_CHAT_ID_ENV, TOUCHES_ENV, WIN_RATE_ENV);
  resetSignalState();
});

after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("getTelegramConfig requires both token and chat id", () => {
  assert.equal(getTelegramConfig({}), null);
  assert.equal(getTelegramConfig({ [TELEGRAM_BOT_TOKEN_ENV]: "tok" }), null);
  assert.equal(getTelegramConfig({ [TELEGRAM_CHAT_ID_ENV]: "-100" }), null);
  assert.equal(getTelegramConfig({ [TELEGRAM_BOT_TOKEN_ENV]: "  ", [TELEGRAM_CHAT_ID_ENV]: "-100" }), null);
  assert.deepEqual(
    getTelegramConfig({ [TELEGRAM_BOT_TOKEN_ENV]: " tok ", [TELEGRAM_CHAT_ID_ENV]: " -100 " }),
    { token: "tok", chatId: "-100" },
  );
});

test("sendTelegram is a no-op without configuration", async () => {
  assert.equal(await sendTelegram(makeAlert(), null), false);
  assert.equal(await sendTelegram(makeAlert()), false);
  assert.equal(captured, null);
});

test("sendTelegram posts the formatted alert to the bot endpoint", async () => {
  const sent = await sendTelegram(makeAlert(), { token: "tok", chatId: "-100" });

  assert.equal(sent, true);
  assert.ok(captured);
  assert.equal(captured.url, "https://api.telegram.org/bottok/sendMessage");
  assert.equal(captured.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(captured.init?.body)), {
    chat_id: "-100",
    text: [
      "⚽ Alert over 0.5 HT!",
      "🏆 Serie A 🇮🇹",
      "💹 Live, Win Rate: ➡️ 80%",
      "⏱ 23°",
      "🎽 Inter vs Milan [1-0]",
      "ℹ️ Tocchi area: 30",
      "ℹ️ Rapporto: 0.53",
    ].join("\n"),
  });
});

test("sendTelegram falls back to n/a for missing minute, score and touches", async () => {
  await sendTelegram(
    makeAlert({ minute: null, homeScore: null, awayScore: null, touches: null, value: null }),
    { token: "t", chatId: "c" },
  );

  const body = JSON.parse(String(captured?.init?.body));
  assert.match(body.text, /⏱ n\/a/);
  assert.match(body.text, /🎽 Inter vs Milan$/m);
  assert.match(body.text, /ℹ️ Tocchi area: n\/a/);
  assert.match(body.text, /ℹ️ Rapporto: n\/a/);
});

test("getWinRate defaults to 80 and honours the env override", () => {
  assert.equal(getWinRate({}), 80);
  assert.equal(getWinRate({ [WIN_RATE_ENV]: "72.5" }), 72);
  assert.equal(getWinRate({ [WIN_RATE_ENV]: "abc" }), 80);
});

test("sendTelegram reads the win rate from the env", async () => {
  process.env[WIN_RATE_ENV] = "95";

  await sendTelegram(makeAlert(), { token: "t", chatId: "c" });

  const body = JSON.parse(String(captured?.init?.body));
  assert.match(body.text, /💹 Live, Win Rate: ➡️ 95%/);
});

test("countryFlag maps known countries and ignores unknown ones", () => {
  assert.equal(countryFlag("Italia"), "🇮🇹");
  assert.equal(countryFlag(" portogallo "), "🇵🇹");
  assert.equal(countryFlag("Atlantide"), "");
  assert.equal(countryFlag(undefined), "");
});

test("sendTelegram throws on a non-2xx response", async () => {
  nextResponse = makeResponse("Too Many Requests", false, 429);

  await assert.rejects(
    () => sendTelegram(makeAlert(), { token: "t", chatId: "c" }),
    /Telegram HTTP 429/,
  );
});

test("dispatchAlerts sends every alert in order", async () => {
  const sent: string[] = [];
  await dispatchAlerts([makeAlert({ matchId: "a" }), makeAlert({ matchId: "b" })], async (alert) => {
    sent.push(alert.matchId);
    return true;
  });

  assert.deepEqual(sent, ["a", "b"]);
});

test("dispatchAlerts isolates sender failures and keeps sending", async () => {
  const sent: string[] = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.doesNotReject(() =>
      dispatchAlerts(
        [makeAlert({ matchId: "a" }), makeAlert({ matchId: "b" }), makeAlert({ matchId: "c" })],
        async (alert) => {
          sent.push(alert.matchId);
          if (alert.matchId === "b") {
            throw new Error("boom");
          }
          return true;
        },
      )
    );
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(sent, ["a", "b", "c"]);
});

test("evaluateSignals fires at most once per match and signal", () => {
  const fakeSignal: Signal = { name: "fake", evaluate: () => makeAlert({ rule: "fake" }) };
  const stats = touchStats("1", "1");

  assert.equal(evaluateSignals(signalMatch(), stats, [fakeSignal]).length, 1);
  assert.equal(evaluateSignals(signalMatch({ id: "m2" }), stats, [fakeSignal]).length, 1);
  assert.equal(evaluateSignals(signalMatch(), stats, [fakeSignal]).length, 0);

  resetSignalState();
  assert.equal(evaluateSignals(signalMatch(), stats, [fakeSignal]).length, 1);
});

test("touchRatioSignal fires when the ratio meets the default threshold", () => {
  const alert = touchRatioSignal.evaluate(signalMatch(), touchStats("20", "10"));

  assert.ok(alert);
  assert.equal(alert.rule, TOUCH_RATIO_SIGNAL);
  assert.equal(alert.text, "Alert over 0.5 HT!");
  assert.equal(alert.minute, 45);
  assert.equal(alert.threshold, DEFAULT_TOUCHES_THRESHOLD);
  assert.equal(alert.tournament, "Serie A");
  assert.equal(alert.country, "Italia");
  assert.equal(alert.homeScore, 1);
  assert.equal(alert.awayScore, 0);
  assert.equal(alert.touches, 30);
  assert.ok(Math.abs(alert.value! - 30 / 45) < 1e-9);
});

test("touchRatioSignal stays silent below the threshold", () => {
  assert.equal(touchRatioSignal.evaluate(signalMatch(), touchStats("5", "5")), null);
});

test("touchRatioSignal honors the threshold env override", () => {
  process.env[TOUCHES_ENV] = "0.1";

  const alert = touchRatioSignal.evaluate(signalMatch(), touchStats("5", "0"));

  assert.ok(alert);
  assert.equal(alert.threshold, 0.1);
});

test("touchRatioSignal stays silent on missing or non-numeric stats", () => {
  assert.equal(
    touchRatioSignal.evaluate(signalMatch(), { all: {}, first_half: {}, second_half: {} }),
    null,
  );
  assert.equal(touchRatioSignal.evaluate(signalMatch(), touchStats("x%", "10")), null);
});

test("touchRatioSignal stays silent without first-half minutes", () => {
  assert.equal(touchRatioSignal.evaluate(signalMatch({ stage_id: 20 }), touchStats("30", "10")), null);
});

test("firstHalfMinutes derives elapsed minutes from stage_start", () => {
  const now = 1700000000 + 10 * 60;
  assert.equal(firstHalfMinutes(signalMatch(), now), 11);
});

test("firstHalfMinutes clamps elapsed minutes to 1..45", () => {
  assert.equal(firstHalfMinutes(signalMatch(), 1700000000 - 600), 1);
  assert.equal(firstHalfMinutes(signalMatch(), 1700000000 + 99 * 60), 45);
});

test("firstHalfMinutes returns 45 on halftime and later first-half stages", () => {
  for (const stage of [6, 7, 10, 11, 13, 38, 39]) {
    assert.equal(firstHalfMinutes(signalMatch({ stage_id: stage })), 45, `stage ${stage}`);
  }
});

test("firstHalfMinutes returns null when minutes cannot be determined", () => {
  assert.equal(firstHalfMinutes(signalMatch({ stage_id: null })), null);
  assert.equal(firstHalfMinutes(signalMatch({ stage_start: null })), null);
  assert.equal(firstHalfMinutes(signalMatch({ stage_id: 20 })), null);
});

test("matchPeriod maps only first and second half stages", () => {
  assert.equal(matchPeriod(signalMatch({ stage_id: 12 })), "first_half");
  assert.equal(matchPeriod(signalMatch({ stage_id: 13 })), "second_half");
  assert.equal(matchPeriod(signalMatch({ stage_id: 38 })), null);
  assert.equal(matchPeriod(signalMatch({ stage_id: null })), null);
});

test("matchMinute derives absolute minutes for both halves", () => {
  const start = 1700000000;
  assert.equal(matchMinute(signalMatch({ stage_id: 12, stage_start: start }), start + 9 * 60), 10);
  assert.equal(matchMinute(signalMatch({ stage_id: 13, stage_start: start }), start + 9 * 60), 55);
});

test("matchMinute clamps first-half minutes to 1..45", () => {
  const start = 1700000000;
  assert.equal(matchMinute(signalMatch({ stage_id: 12, stage_start: start }), start - 600), 1);
  assert.equal(matchMinute(signalMatch({ stage_id: 12, stage_start: start }), start + 99 * 60), 45);
});

test("matchMinute clamps second-half minutes to 46..90", () => {
  const start = 1700000000;
  assert.equal(matchMinute(signalMatch({ stage_id: 13, stage_start: start }), start - 600), 46);
  assert.equal(matchMinute(signalMatch({ stage_id: 13, stage_start: start }), start + 99 * 60), 90);
});

test("matchMinute returns null outside the halves", () => {
  assert.equal(matchMinute(signalMatch({ stage_id: 20 })), null);
  assert.equal(matchMinute(signalMatch({ stage_id: 12, stage_start: null })), null);
  assert.equal(matchMinute(signalMatch({ stage_id: null })), null);
});

test("goalOverSignal fires a first-half alert on a 0-0 in the 10'-30' window", () => {
  const alert = goalOverSignal.evaluate(goalMatch(), touchStats("15", "10"));

  assert.ok(alert);
  assert.equal(alert.rule, GOAL_OVER_SIGNAL);
  assert.equal(alert.text, GOAL_OVER_HT_TEXT);
  assert.equal(alert.minute, 15);
  assert.equal(alert.threshold, 0.5);
  assert.equal(alert.tournament, "Serie A");
  assert.equal(alert.country, "Italia");
  assert.equal(alert.homeScore, 0);
  assert.equal(alert.awayScore, 0);
  assert.equal(alert.touches, 25);
  assert.ok(Math.abs(alert.value! - 25 / 15) < 1e-9);
});

test("goalOverSignal fires a second-half alert on a 0-0 in the 50'-70' window", () => {
  const match = goalMatch({
    stage_id: 13,
    stage_start: Math.floor(Date.now() / 1000) - 9 * 60,
  });
  const alert = goalOverSignal.evaluate(match, touchStats("0", "0"));

  assert.ok(alert);
  assert.equal(alert.text, GOAL_OVER_FT_TEXT);
  assert.equal(alert.minute, 55);
  assert.equal(alert.touches, 0);
  assert.equal(alert.value, 0);
});

test("goalOverSignal stays silent outside the configured windows", () => {
  const early = goalMatch({ stage_start: Math.floor(Date.now() / 1000) - 4 * 60 });
  const late = goalMatch({ stage_start: Math.floor(Date.now() / 1000) - 34 * 60 });
  const secondEarly = goalMatch({
    stage_id: 13,
    stage_start: Math.floor(Date.now() / 1000) - 2 * 60,
  });
  const secondLate = goalMatch({
    stage_id: 13,
    stage_start: Math.floor(Date.now() / 1000) - 34 * 60,
  });

  assert.equal(goalOverSignal.evaluate(early, touchStats("0", "0")), null);
  assert.equal(goalOverSignal.evaluate(late, touchStats("0", "0")), null);
  assert.equal(goalOverSignal.evaluate(secondEarly, touchStats("0", "0")), null);
  assert.equal(goalOverSignal.evaluate(secondLate, touchStats("0", "0")), null);
});

test("goalOverSignal excludes every score that is not 0-0", () => {
  assert.equal(goalOverSignal.evaluate(goalMatch({ home_score: 1 }), touchStats("0", "0")), null);
  assert.equal(goalOverSignal.evaluate(goalMatch({ away_score: 1 }), touchStats("0", "0")), null);
  assert.equal(goalOverSignal.evaluate(goalMatch({ home_score: null }), touchStats("0", "0")), null);
  assert.equal(goalOverSignal.evaluate(goalMatch({ home_score: 2, away_score: 1 }), touchStats("0", "0")), null);
});

test("goalOverSignal reports the configured windows", () => {
  assert.deepEqual({ ...FIRST_HALF_WINDOW }, { min: 10, max: 30 });
  assert.deepEqual({ ...SECOND_HALF_WINDOW }, { min: 50, max: 70 });
});

test("sendTelegram keeps the touch-ratio details for goal alerts", async () => {
  const alert = goalOverSignal.evaluate(goalMatch(), touchStats("15", "10"));
  assert.ok(alert);

  await sendTelegram(alert, { token: "t", chatId: "c" });

  const text = JSON.parse(String(captured?.init?.body)).text as string;
  assert.equal(
    text,
    [
      `⚽ ${GOAL_OVER_HT_TEXT}`,
      "🏆 Serie A 🇮🇹",
      "💹 Live, Win Rate: ➡️ 80%",
      "⏱ 15°",
      "🎽 Inter vs Milan [0-0]",
      "ℹ️ Tocchi area: 25",
      "ℹ️ Rapporto: 1.67",
    ].join("\n"),
  );
});
