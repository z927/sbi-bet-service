import { fetchFeed, toInt } from "./transport.ts";

export const getLineups = async (matchId: string): Promise<Record<string, unknown>> => {
  const records = await fetchFeed(`df_li_1_${matchId}`);
  const result: Record<string, unknown> = {
    formation: {},
    home: [],
    away: [],
    home_bench: [],
    away_bench: [],
    coaches: {},
  };
  let side: "home" | "away" = "home";
  let section = "starters";
  for (const rec of records) {
    if ("LP" in rec && "LI" in rec) {
      const player = {
        id: rec["LP"],
        name: rec["LI"],
        number: toInt(rec["LJ"]),
        nationality: rec["LQ"] ?? "",
      };
      if (section === "starters" && "LD" in rec) {
        (result["formation"] as Record<string, string>)[side] = rec["LD"]!;
      }
      if (section === "bench") {
        (result[`${side}_bench`] as unknown[]).push(player);
      } else if (section === "coaches") {
        (result["coaches"] as Record<string, unknown>)[side] = player;
      } else {
        (result[side] as unknown[]).push(player);
      }
    } else if ("LB" in rec) {
      const label = rec["LB"] ?? "";
      if (label.includes("Panchina")) {
        section = "bench";
      } else if (label.includes("Allenator")) {
        section = "coaches";
      } else {
        section = "starters";
      }
      side = "home";
    } else if ("LC" in rec && !("LA" in rec) && !("LB" in rec)) {
      side = side === "home" ? "away" : "home";
    }
  }
  return result;
}
