const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";

export interface ApiFootballFixture {
  fixture: { id: number; date: string; status: { short: string } };
  league: { id: number; name: string; country: string };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
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
    const data = (await httpGet(`/fixtures?date=${date}`)) as { response?: ApiFootballFixture[] };
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
