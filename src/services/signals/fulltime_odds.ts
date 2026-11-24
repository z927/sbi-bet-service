import { getLiveOdds } from "../api_football.ts";
import { getStrategyLogger } from "../../logger.ts";

export interface FulltimeGoalOdds {
  over15: number | null;
  over25: number | null;
}

const FULL_TIME_BET_ID = 36;
const FULL_TIME_BET_NAME = "Over/Under Line";

const asNumber = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const handicapFromValue = (value: string): number | null => {
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  return Number.parseFloat(match[1]!);
};

const findOverUnderOdd = (bets: unknown[], handicap: number): number | null => {
  for (const bet of bets) {
    const betId = (bet as { id?: unknown }).id;
    const betName = String((bet as { name?: string }).name ?? "");
    const isFullTime =
      (betId !== undefined && betId !== null && Number(betId) === FULL_TIME_BET_ID) ||
      betName === FULL_TIME_BET_NAME;
    if (!isFullTime) {
      continue;
    }
    const values = (bet as { values?: unknown[] }).values ?? [];
    for (const v of values) {
      const val = v as { value?: string; odd?: string | number; handicap?: unknown };
      if (val.value !== "Over") {
        continue;
      }
      let h: number | null = null;
      if (val.handicap !== undefined && val.handicap !== null) {
        h = asNumber(val.handicap);
      } else {
        h = handicapFromValue(String(val.value ?? ""));
      }
      if (h === null || h !== handicap) {
        continue;
      }
      return asNumber(val.odd);
    }
  }
  return null;
};

export const fetchFulltimeGoalOdds = async (
  fixtureId: number,
): Promise<FulltimeGoalOdds> => {
  try {
    const odds = await getLiveOdds(fixtureId);
    const allBets = odds.flatMap((o) => o.odds ?? []);
    return {
      over15: findOverUnderOdd(allBets, 1.5),
      over25: findOverUnderOdd(allBets, 2.5),
    };
  } catch (exc) {
    getStrategyLogger().error(
      { err: exc, fixtureId },
      "fulltime goal odds lookup failed",
    );
    return { over15: null, over25: null };
  }
};
