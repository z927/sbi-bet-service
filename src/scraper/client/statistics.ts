import { fetchFeed, toInt } from "./transport.ts";

export const getStatistics = async (matchId: string): Promise<{ groups: unknown[] }> => {
  const records = await fetchFeed(`df_st_1_${matchId}`);
  const groups: Array<{ period: string; stats: unknown[] }> = [];
  let current: { period: string; stats: unknown[] } | null = null;
  for (const rec of records) {
    if ("SF" in rec || "SE" in rec) {
      const title = rec["SF"] ?? rec["SE"] ?? "Statistiche";
      current = { period: title, stats: [] };
      groups.push(current);
      if (!("SD" in rec)) {
        continue;
      }
    }
    if ("SD" in rec && current !== null) {
      current.stats.push({
        id: toInt(rec["SD"]),
        name: rec["SG"] ?? "",
        home: rec["SH"] ?? "",
        away: rec["SI"] ?? "",
      });
    }
  }
  return { groups };
}
