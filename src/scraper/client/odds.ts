import { BASE_URL, httpGet } from "./transport.ts";

const ODDS_URL = "https://global.ds.lsapp.eu/odds/pq_graphql";
const LIVE_ODDS_URL = "https://400.ds.lsapp.eu/pq_graphql";
const LIVE_ODDS_PROJECT_ID = 2;

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
): Promise<{ bookmakers: string[]; markets: unknown[] }> => {
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

  const markets: Array<Record<string, unknown>> = [];
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
  const activeBooks = [...new Set(markets.map((m) => m["bookmaker"] as string).filter((b) => b))].sort();
  return { bookmakers: activeBooks, markets };
}

export interface LiveOddsBookmaker {
  id: number;
  name: string;
}

export interface LiveOddsMenuItem {
  betType: string;
  betScope: string;
  bookmakerIds: number[];
  isActive: boolean;
  isDefault: boolean;
}

export interface LiveOddsMenu {
  bookmakers: LiveOddsBookmaker[];
  items: LiveOddsMenuItem[];
}

export interface LiveOddsPrice {
  value: number;
  active: boolean;
}

export interface LiveOverUnderLine {
  handicap: string | null;
  over: LiveOddsPrice | null;
  under: LiveOddsPrice | null;
}

export interface LiveOddsOffer {
  bookmakerId: number;
  bookmaker: string;
  betType: string;
  betScope: string;
  home: LiveOddsPrice | null;
  draw: LiveOddsPrice | null;
  away: LiveOddsPrice | null;
  none: LiveOddsPrice | null;
  lines: LiveOverUnderLine[];
}

export interface LiveOddsOptions {
  geo?: string;
  projectId?: number;
  bookmakerIds?: number[];
  concurrency?: number;
}

const asRecord = (value: unknown): Record<string, unknown> => {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

const asArray = (value: unknown): unknown[] => {
  return Array.isArray(value) ? value : [];
}

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const parseLivePrice = (value: unknown): LiveOddsPrice | null => {
  const item = asRecord(value);
  const price = toNumber(item["value"]);
  if (price === null) {
    return null;
  }
  return { value: price, active: item["active"] !== false };
}

const parseLiveMenu = (payload: unknown): LiveOddsMenu => {
  const data = asRecord(asRecord(payload)["data"]);
  const menu = asRecord(data["getLiveOddsBettingTypeMenu"]);
  const settings = asRecord(menu["settings"]);

  const bookmakers: LiveOddsBookmaker[] = [];
  for (const raw of asArray(settings["bookmakers"])) {
    const bookmaker = asRecord(asRecord(raw)["bookmaker"]);
    const id = toNumber(bookmaker["id"]);
    if (id === null) {
      continue;
    }
    bookmakers.push({
      id,
      name: typeof bookmaker["name"] === "string" ? bookmaker["name"] : "",
    });
  }

  const items: LiveOddsMenuItem[] = [];
  for (const raw of asArray(menu["items"])) {
    const item = asRecord(raw);
    const betType = item["bettingType"];
    const betScope = item["bettingScope"];
    if (typeof betType !== "string" || typeof betScope !== "string") {
      continue;
    }
    const bookmakerIds: number[] = [];
    for (const rawId of asArray(item["bookmakerIds"])) {
      const id = toNumber(rawId);
      if (id !== null) {
        bookmakerIds.push(id);
      }
    }
    items.push({
      betType,
      betScope,
      bookmakerIds,
      isActive: item["isActive"] === true,
      isDefault: item["isDefault"] === true,
    });
  }

  return { bookmakers, items };
}

const parseLiveOffer = (
  value: unknown,
  bookmakerId: number,
  betType: string,
  betScope: string,
): LiveOddsOffer => {
  const overview = asRecord(value);
  const lines: LiveOverUnderLine[] = [];
  for (const raw of asArray(overview["opportunities"])) {
    const line = asRecord(raw);
    const handicapValue = asRecord(line["handicap"])["value"];
    let handicap: string | null = null;
    if (typeof handicapValue === "string") {
      handicap = handicapValue;
    } else {
      const numeric = toNumber(handicapValue);
      handicap = numeric === null ? null : String(numeric);
    }
    lines.push({
      handicap,
      over: parseLivePrice(line["over"]),
      under: parseLivePrice(line["under"]),
    });
  }

  return {
    bookmakerId,
    bookmaker: "",
    betType,
    betScope,
    home: parseLivePrice(overview["home"]),
    draw: parseLivePrice(overview["draw"]),
    away: parseLivePrice(overview["away"]),
    none: parseLivePrice(overview["none"]),
    lines,
  };
}

export const getLiveOddsMenu = async (
  matchId: string,
  geo = "IT",
  projectId = LIVE_ODDS_PROJECT_ID,
): Promise<LiveOddsMenu> => {
  const params = new URLSearchParams({
    _hash: "lobtm",
    eventId: matchId,
    projectId: String(projectId),
    geoIpCode: geo,
    geoIpSubdivisionCode: "",
  });
  const raw = await httpGet(`${LIVE_ODDS_URL}?${params.toString()}`, {
    Origin: BASE_URL,
    Accept: "application/json",
  });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { bookmakers: [], items: [] };
  }
  return parseLiveMenu(payload);
}

export const getLiveOdds = async (
  matchId: string,
  bookmakerId: number,
  betType: string,
  betScope = "FULL_TIME",
): Promise<LiveOddsOffer | null> => {
  const params = new URLSearchParams({
    _hash: "ole2",
    eventId: matchId,
    bookmakerId: String(bookmakerId),
    betType,
    betScope,
  });
  const raw = await httpGet(`${LIVE_ODDS_URL}?${params.toString()}`, {
    Origin: BASE_URL,
    Accept: "application/json",
  });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const data = asRecord(payload["data"]);
  const overview = asRecord(data["findLiveOddsForBookmaker"])["eventOddsOverview"];
  if (overview === null || overview === undefined) {
    return null;
  }
  return parseLiveOffer(overview, bookmakerId, betType, betScope);
}

export const getLiveOddsOffers = async (
  matchId: string,
  betType: string,
  betScope = "FULL_TIME",
  options: LiveOddsOptions = {},
): Promise<LiveOddsOffer[]> => {
  const menu = await getLiveOddsMenu(
    matchId,
    options.geo ?? "IT",
    options.projectId ?? LIVE_ODDS_PROJECT_ID,
  );
  const item = menu.items.find(
    (candidate) =>
      candidate.betType === betType &&
      candidate.betScope === betScope &&
      candidate.isActive,
  );
  if (item === undefined) {
    return [];
  }

  const names = new Map(menu.bookmakers.map((bookmaker) => [bookmaker.id, bookmaker.name] as const));
  const requested = options.bookmakerIds ?? item.bookmakerIds;
  const ids = [...new Set(requested)];
  if (ids.length === 0) {
    return [];
  }

  const offers: LiveOddsOffer[] = [];
  let index = 0;
  const workers = Math.max(1, Math.min(options.concurrency ?? 4, ids.length));
  const run = async (): Promise<void> => {
    while (index < ids.length) {
      const bookmakerId = ids[index++];
      if (bookmakerId === undefined) {
        break;
      }
      try {
        const offer = await getLiveOdds(matchId, bookmakerId, betType, betScope);
        if (offer !== null) {
          offer.bookmaker = names.get(bookmakerId) ?? "";
          offers.push(offer);
        }
      } catch (exc) {
        const message = exc instanceof Error ? exc.message : String(exc);
        console.error(
          `[odds] live odds failed for ${matchId} (${betType}/${betScope}, bookmaker ${bookmakerId}): ${message}`,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, run));
  offers.sort((a, b) => a.bookmakerId - b.bookmakerId);
  return offers;
}
