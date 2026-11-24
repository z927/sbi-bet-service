import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fetchFulltimeGoalOdds, type FulltimeGoalOdds } from "../src/services/signals/fulltime_odds.ts";

const originalFetch = globalThis.fetch;

const makeResponse = (body: string, ok = true, status = 200): Response => {
  return { ok, status, text: async () => body } as unknown as Response;
};

const fulltimeOdds = [
  {
    fixture: { id: 7, status: { long: "Match Finished", elapsed: 90, seconds: "90:00" } },
    league: { id: 78, season: 2026 },
    teams: { home: { id: 100, goals: 0 }, away: { id: 101, goals: 0 } },
    status: { stopped: false, blocked: false, finished: false },
    update: new Date().toISOString(),
    odds: [
      {
        id: 36,
        name: "Over/Under Line",
        values: [
          { value: "Over", odd: "1.55", handicap: "1.5", main: true, suspended: false },
          { value: "Under", odd: "2.4", handicap: "1.5", main: true, suspended: false },
          { value: "Over", odd: "1.9", handicap: "2.5", main: true, suspended: false },
          { value: "Under", odd: "1.9", handicap: "2.5", main: true, suspended: false },
        ],
      },
    ],
  },
];

const noFulltimeOdds = [
  {
    fixture: { id: 7, status: { long: "First Half", elapsed: 20, seconds: "20:00" } },
    league: { id: 78, season: 2026 },
    teams: { home: { id: 100, goals: 0 }, away: { id: 101, goals: 0 } },
    status: { stopped: false, blocked: false, finished: false },
    update: new Date().toISOString(),
    odds: [
      {
        id: 24,
        name: "Over/Under Line (1st Half)",
        values: [
          { value: "Over", odd: "1.8", handicap: "0.5", main: true, suspended: false },
          { value: "Under", odd: "2.0", handicap: "0.5", main: true, suspended: false },
        ],
      },
    ],
  },
];

const fetchFor = (response: { response: unknown[] }): typeof fetch => {
  return ((url: string) => {
    if (String(url).includes("/odds")) {
      return makeResponse(JSON.stringify(response));
    }
    return makeResponse("{}");
  }) as unknown as typeof fetch;
};

test("extracts over 1.5 and over 2.5 full-time odds from bet id 36", async () => {
  globalThis.fetch = fetchFor({ response: fulltimeOdds });
  try {
    const odds: FulltimeGoalOdds = await fetchFulltimeGoalOdds(7);
    assert.equal(odds.over15, 1.55);
    assert.equal(odds.over25, 1.9);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns null when no full-time over/under bet is present", async () => {
  globalThis.fetch = fetchFor({ response: noFulltimeOdds });
  try {
    const odds: FulltimeGoalOdds = await fetchFulltimeGoalOdds(7);
    assert.equal(odds.over15, null);
    assert.equal(odds.over25, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

after(() => {
  globalThis.fetch = originalFetch;
});
