import { fetchFeed, toInt } from "./transport.ts";
import type { StatCategory, Statistics } from "../models.ts";

const PERIOD_KEYS: Record<string, string> = {
  partita: "all",
  match: "all",
  all: "all",
  "1 tempo": "first_half",
  "primo tempo": "first_half",
  "first half": "first_half",
  "2 tempo": "second_half",
  "secondo tempo": "second_half",
  "second half": "second_half",
};

const CATEGORY_KEYS: Record<string, string> = {
  "statistiche top": "top",
  tiri: "shots",
  attacco: "attack",
  passaggi: "passing",
  difesa: "defense",
  portiere: "goalkeeper",
};

const normalize = (value: string): string => {
  return value.toLowerCase().replace(/°/g, "").replace(/\s+/g, " ").trim();
}

const periodKey = (label: string): string => {
  const key = normalize(label);
  return PERIOD_KEYS[key] ?? key.replace(/\s+/g, "_");
}

const categoryKey = (label: string): string => {
  const key = normalize(label);
  return CATEGORY_KEYS[key] ?? key.replace(/\s+/g, "_");
}

export const getStatistics = async (matchId: string): Promise<Statistics> => {
  const records = await fetchFeed(`df_st_1_${matchId}`);
  const statistics: Statistics = { all: {}, first_half: {}, second_half: {} };
  let period: StatCategory | null = null;
  let category: string | null = null;
  for (const rec of records) {
    if ("SE" in rec) {
      const key = periodKey(rec["SE"] ?? "");
      period = statistics[key] ?? (statistics[key] = {});
      category = null;
    } else if ("SF" in rec) {
      category = categoryKey(rec["SF"] ?? "");
    }
    if ("SD" in rec && period !== null && category !== null) {
      const stats = period[category] ?? (period[category] = []);
      stats.push({
        id: toInt(rec["SD"]),
        name: rec["SG"] ?? "",
        home: rec["SH"] ?? "",
        away: rec["SI"] ?? "",
      });
    }
  }
  return statistics;
}
