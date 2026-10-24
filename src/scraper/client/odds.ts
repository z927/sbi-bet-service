import type { Odds, OddsMarket, OddsMarketSelector, OddsOutcome } from "../models.ts";
import { BASE_URL, httpGet } from "./transport.ts";

const ODDS_URL = "https://global.ds.lsapp.eu/odds/pq_graphql";
export const LIVE_ODDS_URL = "https://400.ds.lsapp.eu/pq_graphql";
export const LIVE_ODDS_PROJECT_ID = 400;

const normHandicap = (value: unknown): unknown => {
  if (value !== null && typeof value === "object") {
    return (value as Record<string, unknown>)["value"];
  }
  return value;
}

const selectionLabel = (
  betType: string,
  count: number,
  item: Record<string, unknown>,
  index: number,
): string | null => {
  if (betType === "HOME_DRAW_AWAY") {
    if (item["eventParticipantId"] === null || item["eventParticipantId"] === undefined) {
      return "X";
    }
    return index === 0 ? "1" : "2";
  }
  if (betType === "HOME_AWAY") {
    return index === 0 ? "1" : "2";
  }
  if (betType === "BOTH_TEAMS_TO_SCORE") {
    return index === 0 ? "SI" : "NO";
  }
  if (betType === "DOUBLE_CHANCE") {
    return index < 3 ? (["1X", "12", "X2"] as const)[index]! : null;
  }
  if (betType === "DRAW_NO_BET") {
    return index === 0 ? "1" : "2";
  }
  if (betType === "OVER_UNDER") {
    return index < count / 2 ? "OVER" : "UNDER";
  }
  return null;
}

export const getOdds = async (
  matchId: string,
  geo = "IT",
  projectId = 2,
): Promise<Odds> => {
  const params = new URLSearchParams({
    _hash: "oce",
    eventId: matchId,
    projectId: String(projectId),
    geoIpCode: geo,
    geoIpSubdivisionCode: "",
  });
  const raw = await httpGet(`${ODDS_URL}?${params.toString()}`, {
    Origin: BASE_URL,
    Accept: "application/json",
  });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { bookmakers: [], markets: [] };
  }
  const data = (payload["data"] as Record<string, unknown> | undefined) ?? {};
  const event = (data["findOddsByEventId"] as Record<string, unknown> | undefined) ?? {};
  if (!event || Object.keys(event).length === 0) {
    return { bookmakers: [], markets: [] };
  }

  const bookmakers: Record<string, string> = {};
  const settings = (event["settings"] as Record<string, unknown> | undefined) ?? {};
  for (const entry of (settings["bookmakers"] as Array<Record<string, unknown>> | undefined) ?? []) {
    const bookmaker = (entry["bookmaker"] as Record<string, unknown> | undefined) ?? {};
    bookmakers[String(bookmaker["id"])] = (bookmaker["name"] as string | undefined) ?? "";
  }

  const markets: Odds["markets"] = [];
  for (const entry of (event["odds"] as Array<Record<string, unknown>> | undefined) ?? []) {
    const oddsItems = (entry["odds"] as Array<Record<string, unknown>> | undefined) ?? [];
    if (oddsItems.length === 0) {
      continue;
    }
    const betType = (entry["bettingType"] as string | undefined) ?? "";
    const count = oddsItems.length;
    const outcomes = oddsItems.map((item, index) => ({
      label: selectionLabel(betType, count, item, index),
      value: item["value"],
      opening: item["opening"],
      handicap: normHandicap(item["handicap"]),
      active: item["active"],
    }));
    markets.push({
      bookmaker_id: String(entry["bookmakerId"]),
      bookmaker: bookmakers[String(entry["bookmakerId"])] ?? "",
      bet_type: betType,
      scope: entry["bettingScope"],
      live: entry["hasLiveBettingOffers"],
      outcomes,
    });
  }
  const activeBooks = [...new Set(markets.map((m) => m.bookmaker).filter((b) => b))].sort();
  return { bookmakers: activeBooks, markets };
}

const asOddsValue = (value: unknown): number | null => {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const bestLiveOutcome = (
  odds: Odds,
  selector: OddsMarketSelector,
): number | null => {
  const values: number[] = [];
  for (const market of odds.markets) {
    if (market.live !== true) {
      continue;
    }
    if (market.bet_type !== selector.betType || market.scope !== selector.scope) {
      continue;
    }
    for (const outcome of market.outcomes) {
      if (outcome.label !== selector.selection || outcome.active !== true) {
        continue;
      }
      if (String(outcome.handicap) !== String(selector.handicap)) {
        continue;
      }
      const value = asOddsValue(outcome.value);
      if (value !== null) {
        values.push(value);
      }
    }
  }
  return values.length === 0 ? null : Math.max(...values);
}

interface LiveOddsMenuItem {
  bettingType?: string;
  bettingScope?: string;
  types?: string[];
  bookmakerIds?: Array<string | number>;
}

const fetchJson = async (url: string): Promise<Record<string, unknown>> => {
  try {
    const raw = await httpGet(url, { Origin: BASE_URL, Accept: "application/json" });
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const getLiveOddsMenu = async (
  matchId: string,
  geo = "IT",
  projectId = LIVE_ODDS_PROJECT_ID,
): Promise<{ bookmakers: Record<string, string>; items: LiveOddsMenuItem[] }> => {
  const params = new URLSearchParams({
    _hash: "lobtm",
    eventId: matchId,
    projectId: String(projectId),
    geoIpCode: geo,
    geoIpSubdivisionCode: "",
  });
  const payload = await fetchJson(`${LIVE_ODDS_URL}?${params.toString()}`);
  const data = (payload["data"] as Record<string, unknown> | undefined) ?? {};
  const menu = (data["getLiveOddsBettingTypeMenu"] as Record<string, unknown> | undefined) ?? {};
  if (!menu || Object.keys(menu).length === 0) {
    return { bookmakers: {}, items: [] };
  }
  const settings = (menu["settings"] as Record<string, unknown> | undefined) ?? {};
  const bookmakers: Record<string, string> = {};
  for (const entry of (settings["bookmakers"] as Array<Record<string, unknown>> | undefined) ?? []) {
    const bookmaker = (entry["bookmaker"] as Record<string, unknown> | undefined) ?? {};
    const id = bookmaker["id"];
    if (id !== undefined && id !== null) {
      bookmakers[String(id)] = (bookmaker["name"] as string | undefined) ?? "";
    }
  }
  const items: LiveOddsMenuItem[] = [];
  for (const item of (menu["items"] as Array<Record<string, unknown>> | undefined) ?? []) {
    const types = item["types"];
    if (!Array.isArray(types) || !types.includes("LIVE")) {
      continue;
    }
    if (item["bettingType"] !== "OVER_UNDER") {
      continue;
    }
    items.push({
      bettingType: item["bettingType"] as string | undefined,
      bettingScope: item["bettingScope"] as string | undefined,
      types: types as string[],
      bookmakerIds: (item["bookmakerIds"] as Array<string | number> | undefined) ?? [],
    });
  }
  return { bookmakers, items };
}

const getLiveOverUnderMarket = async (
  matchId: string,
  bookmakerId: string,
  scope: string,
  bookmakerName: string,
): Promise<OddsMarket | null> => {
  const params = new URLSearchParams({
    _hash: "ole2",
    eventId: matchId,
    bookmakerId,
    betType: "OVER_UNDER",
    betScope: scope,
  });
  const payload = await fetchJson(`${LIVE_ODDS_URL}?${params.toString()}`);
  const data = (payload["data"] as Record<string, unknown> | undefined) ?? {};
  const bookmakerOdds =
    (data["findLiveOddsForBookmaker"] as Record<string, unknown> | undefined) ?? {};
  const overview =
    (bookmakerOdds["eventOddsOverview"] as Record<string, unknown> | undefined) ?? {};
  if (!overview || Object.keys(overview).length === 0) {
    return null;
  }
  const opportunities = (overview["opportunities"] as Array<Record<string, unknown>> | undefined) ?? [];
  const outcomes: OddsOutcome[] = [];
  for (const opp of opportunities) {
    const handicap = normHandicap(opp["handicap"]);
    const over = opp["over"] as Record<string, unknown> | undefined;
    if (over) {
      outcomes.push({
        label: "OVER",
        value: over["value"],
        opening: over["opening"],
        handicap,
        active: over["active"],
      });
    }
    const under = opp["under"] as Record<string, unknown> | undefined;
    if (under) {
      outcomes.push({
        label: "UNDER",
        value: under["value"],
        opening: under["opening"],
        handicap,
        active: under["active"],
      });
    }
  }
  if (outcomes.length === 0) {
    return null;
  }
  return {
    bookmaker_id: bookmakerId,
    bookmaker: bookmakerName,
    bet_type: "OVER_UNDER",
    scope,
    live: true,
    outcomes,
  };
}

export const getLiveOdds = async (
  matchId: string,
  geo = "IT",
  projectId = LIVE_ODDS_PROJECT_ID,
): Promise<Odds> => {
  try {
    const menu = await getLiveOddsMenu(matchId, geo, projectId);
    const tasks: Promise<OddsMarket | null>[] = [];
    for (const item of menu.items) {
      const scope = item.bettingScope;
      if (!scope) {
        continue;
      }
      const bookmakerIds = item.bookmakerIds ?? [];
      for (const id of bookmakerIds) {
        const bookmakerId = String(id);
        if (!bookmakerId) {
          continue;
        }
        tasks.push(getLiveOverUnderMarket(matchId, bookmakerId, scope, menu.bookmakers[bookmakerId] ?? ""));
      }
    }
    const settled = await Promise.allSettled(tasks);
    const markets: OddsMarket[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) {
        markets.push(result.value);
      }
    }
    const activeBooks = [...new Set(markets.map((m) => m.bookmaker).filter((b) => b))].sort();
    return { bookmakers: activeBooks, markets };
  } catch {
    return { bookmakers: [], markets: [] };
  }
}
