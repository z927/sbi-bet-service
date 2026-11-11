const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";

export interface ApiFootballFixture {
  fixture: { id: number; date: string; status: { short: string } };
  league: { id: number; name: string; country: string };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
  direttaMatch?: import("../scraper/models.ts").Match;
}

const apiKey = (): string => process.env.API_FOOTBALL_API_KEY ?? "";

const httpGet = async (path: string): Promise<unknown> => {
  const res = await fetch(`${API_FOOTBALL_BASE_URL}${path}`, {
    headers: { "x-apisports-key": apiKey() },
  });
  if (!res.ok) throw new Error(`API-Football ${res.status}`);
  const text = await res.text();
  return JSON.parse(text);
};

export const listTodayFixtures = async (date: string): Promise<ApiFootballFixture[]> => {
  try {
    const data = (await httpGet(`/fixtures?date=${date}&status=NS&timezone=Europe/Rome`)) as { response?: ApiFootballFixture[] };
    return data.response ?? [];
  } catch {
    return [];
  }
};

export interface ApiFootballOdd {
  bookmakers?: Array<{
    id: number;
    name: string;
    bets?: Array<{
      id: number;
      name: string;
      values?: Array<{ value: string; odd: string | number }>;
    }>;
  }>;
}

export const getLiveOdds = async (fixtureId: number): Promise<ApiFootballOdd[]> => {
  try {
    const data = (await httpGet(`/odds?fixture=${fixtureId}`)) as { response?: ApiFootballOdd[] };
    return data.response ?? [];
  } catch {
    return [];
  }
};

export const listLiveFixtures = async (): Promise<ApiFootballFixture[]> => {
  try {
    const data = (await httpGet("/fixtures?live=all")) as { response?: ApiFootballFixture[] };
    return data.response ?? [];
  } catch {
    return [];
  }
};
