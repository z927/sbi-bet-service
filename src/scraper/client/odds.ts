import { BASE_URL, httpGet } from "./transport.ts";

const ODDS_URL = "https://global.ds.lsapp.eu/odds/pq_graphql";

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
