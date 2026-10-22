import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import {
  getLiveOdds,
  getLiveOddsMenu,
  getLiveOddsOffers,
} from "../src/scraper/client/odds.ts";

const originalFetch = globalThis.fetch;
let requests: string[] = [];
let handler: (url: string) => Response;

const makeResponse = (body: unknown, ok = true, status = 200): Response => {
  return { ok, status, text: async () => JSON.stringify(body) } as unknown as Response;
};

const menuBody = {
  data: {
    getLiveOddsBettingTypeMenu: {
      settings: {
        bookmakers: [
          { bookmaker: { id: 159, name: "Sisal" } },
          { bookmaker: { id: 199, name: "SNAI" } },
          { bookmaker: { id: 419, name: "bet365.it" } },
        ],
      },
      items: [
        {
          bettingType: "OVER_UNDER",
          bettingScope: "FULL_TIME",
          isActive: true,
          isDefault: false,
          bookmakerIds: [159, 199, 419],
        },
        {
          bettingType: "HOME_DRAW_AWAY",
          bettingScope: "FULL_TIME",
          isActive: true,
          isDefault: true,
          bookmakerIds: [],
        },
      ],
    },
  },
};

const overUnderBody = (over: string) => ({
  data: {
    findLiveOddsForBookmaker: {
      eventOddsOverview: {
        type: "OVER_UNDER",
        opportunities: [
          {
            over: { value: over, active: true },
            under: { value: "2.75", active: true },
            handicap: { value: "0.5" },
          },
        ],
      },
    },
  },
});

beforeEach(() => {
  requests = [];
  handler = () => makeResponse({});
  globalThis.fetch = (async (input: string) => {
    const url = String(input);
    requests.push(url);
    return handler(url);
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

test("getLiveOddsMenu parses bookmakers, markets and live hash", async () => {
  handler = () => makeResponse(menuBody);

  const menu = await getLiveOddsMenu("m1");

  assert.deepEqual(menu.bookmakers, [
    { id: 159, name: "Sisal" },
    { id: 199, name: "SNAI" },
    { id: 419, name: "bet365.it" },
  ]);
  assert.deepEqual(menu.items, [
    {
      betType: "OVER_UNDER",
      betScope: "FULL_TIME",
      bookmakerIds: [159, 199, 419],
      isActive: true,
      isDefault: false,
    },
    {
      betType: "HOME_DRAW_AWAY",
      betScope: "FULL_TIME",
      bookmakerIds: [],
      isActive: true,
      isDefault: true,
    },
  ]);
  assert.match(requests[0]!, /_hash=lobtm/);
  assert.match(requests[0]!, /eventId=m1/);
});

test("getLiveOddsMenu tolerates malformed payloads", async () => {
  handler = () => ({ ok: true, status: 200, text: async () => "not json" } as unknown as Response);

  assert.deepEqual(await getLiveOddsMenu("m1"), { bookmakers: [], items: [] });
});

test("getLiveOdds parses live over/under prices", async () => {
  handler = () => makeResponse(overUnderBody("1.52"));

  const offer = await getLiveOdds("m1", 199, "OVER_UNDER", "FULL_TIME");

  assert.ok(offer);
  assert.equal(offer.bookmakerId, 199);
  assert.equal(offer.betType, "OVER_UNDER");
  assert.equal(offer.betScope, "FULL_TIME");
  assert.deepEqual(offer.lines, [
    { handicap: "0.5", over: { value: 1.52, active: true }, under: { value: 2.75, active: true } },
  ]);
  assert.match(requests[0]!, /_hash=ole2/);
  assert.match(requests[0]!, /bookmakerId=199/);
});

test("getLiveOdds returns null when the bookmaker has no live offer", async () => {
  handler = () =>
    makeResponse({ data: { findLiveOddsForBookmaker: { eventOddsOverview: null } } });

  assert.equal(await getLiveOdds("m1", 419, "OVER_UNDER"), null);
});

test("getLiveOddsOffers queries every menu bookmaker and skips empty offers", async () => {
  handler = (url) => {
    if (url.includes("_hash=lobtm")) {
      return makeResponse(menuBody);
    }
    const bookmakerId = Number(new URL(url).searchParams.get("bookmakerId"));
    if (bookmakerId === 419) {
      return makeResponse({ data: { findLiveOddsForBookmaker: { eventOddsOverview: null } } });
    }
    return makeResponse(overUnderBody(bookmakerId === 199 ? "1.52" : "1.38"));
  };

  const offers = await getLiveOddsOffers("m1", "OVER_UNDER", "FULL_TIME");

  assert.deepEqual(
    offers.map((offer) => ({
      bookmakerId: offer.bookmakerId,
      bookmaker: offer.bookmaker,
      over: offer.lines[0]?.over?.value,
    })),
    [
      { bookmakerId: 159, bookmaker: "Sisal", over: 1.38 },
      { bookmakerId: 199, bookmaker: "SNAI", over: 1.52 },
    ],
  );
  assert.equal(requests.filter((url) => url.includes("_hash=ole2")).length, 3);
});

test("getLiveOddsOffers returns nothing when the market is not in the menu", async () => {
  handler = () => makeResponse(menuBody);

  const offers = await getLiveOddsOffers("m1", "OVER_UNDER", "FIRST_HALF");

  assert.deepEqual(offers, []);
  assert.equal(requests.length, 1);
});
