export const BASE_URL = "https://www.diretta.it";
const FEED_URL = BASE_URL + "/x/feed/{feed}";
const FSIGN = "SW9D1eZo";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const RECORD_SEP = "~";
export const FIELD_SEP = "¬";
export const KV_SEP = "÷";

export type FeedRecord = Record<string, string>;

export class FeedError extends Error {
  override readonly name = "FeedError";
}

export const httpGet = async (
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 15000,
): Promise<string> => {
  const baseHeaders: Record<string, string> = {
    "x-fsign": FSIGN,
    "User-Agent": USER_AGENT,
    Accept: "*/*",
    Referer: BASE_URL + "/",
    ...headers,
  };
  let response: Response;
  try {
    response = await fetch(url, { headers: baseHeaders, signal: AbortSignal.timeout(timeoutMs) });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    throw new FeedError(`Errore di rete per ${url}: ${message}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new FeedError(`HTTP ${response.status} per ${url}: ${text.slice(0, 120)}`);
  }
  return text;
}

export const toRecords = (text: string): FeedRecord[] => {
  const records: FeedRecord[] = [];
  for (const chunk of text.split(RECORD_SEP)) {
    const fields: FeedRecord = {};
    for (const part of chunk.split(FIELD_SEP)) {
      if (part.includes(KV_SEP)) {
        const idx = part.indexOf(KV_SEP);
        const key = part.slice(0, idx);
        const value = part.slice(idx + KV_SEP.length);
        fields[key] = value;
      }
    }
    if (Object.keys(fields).length > 0) {
      records.push(fields);
    }
  }
  return records;
}

export const toInt = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export const fetchRaw = async (feed: string): Promise<string> => {
  return httpGet(FEED_URL.replace("{feed}", feed));
}

export const fetchFeed = async (feed: string): Promise<FeedRecord[]> => {
  return toRecords(await fetchRaw(feed));
}
