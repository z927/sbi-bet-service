import { listTodayFixtures, type ApiFootballFixture } from "../../services/api_football.ts";
import { getSettings } from "../../config.ts";
import { getStrategyLogger } from "../../logger.ts";
import { loadTeamMapping } from "../../services/team_mapping.ts";
import * as signalsRepo from "./repo.ts";

export interface SettleResult {
  settled: number;
  skipped: number;
}

const GOAL_OVER_SIGNAL = "goal-over-0.5";

const normalizeName = (name: string): string => name.trim().toLowerCase();

type TeamMapping = import("../../services/team_mapping.ts").TeamMapping;

const resolveApiName = (mapping: TeamMapping[], direttaName: string): string => {
  const m = mapping.find((mm) => normalizeName(mm.direttaName) === normalizeName(direttaName));
  return m ? m.apiFootballName : direttaName;
};

const findFixture = (
  fixtures: ApiFootballFixture[],
  directHome: string | null,
  directAway: string | null,
  mapping: TeamMapping[],
): { homeGoals: number; awayGoals: number } | null => {
  if (!directHome || !directAway) {
    return null;
  }
  const apiHome = resolveApiName(mapping, directHome);
  const apiAway = resolveApiName(mapping, directAway);
  const h = normalizeName(apiHome);
  const a = normalizeName(apiAway);

  for (const f of fixtures) {
    const fh = normalizeName(f.teams.home.name);
    const fa = normalizeName(f.teams.away.name);
    if ((fh === h && fa === a) || (fh === a && fa === h)) {
      if (f.goals.home === null || f.goals.away === null) {
        return null;
      }
      return { homeGoals: f.goals.home, awayGoals: f.goals.away };
    }
  }
  return null;
};

const evaluateWin = (rule: string | null, homeGoals: number, awayGoals: number): boolean | null => {
  if (rule === GOAL_OVER_SIGNAL) {
    return homeGoals + awayGoals >= 1;
  }
  return null;
};

export const settleSignals = async (date?: string): Promise<SettleResult> => {
  const settings = getSettings();
  const targetDate = date ?? new Date().toISOString().slice(0, 10);

  getStrategyLogger().info({ component: "settle_service", date: targetDate }, "settleSignals called");

  const mapping = loadTeamMapping();
  const fixtures = await listTodayFixtures(targetDate);

  const signals = await signalsRepo.getUnsettledSignals();
  if (!signals) {
    return { settled: 0, skipped: 0 };
  }

  let settled = 0;
  let skipped = 0;

  for (const signal of signals) {
    const fixture = findFixture(fixtures, signal.home, signal.away, mapping);
    if (!fixture) {
      skipped += 1;
      continue;
    }
    const win = evaluateWin(signal.rule, fixture.homeGoals, fixture.awayGoals);
    if (win === null) {
      skipped += 1;
      continue;
    }

    try {
      await signalsRepo.updateSignalResult(signal.match_id, {
        homeScore: fixture.homeGoals,
        awayScore: fixture.awayGoals,
        win,
      });
      settled += 1;
      getStrategyLogger().info(
        { component: "settle_service", matchId: signal.match_id, home: signal.home, away: signal.away, homeGoals: fixture.homeGoals, awayGoals: fixture.awayGoals, win },
        "signal settled",
      );
    } catch (exc) {
      getStrategyLogger().error({ err: exc, component: "settle_service", matchId: signal.match_id }, "signal update failed");
      skipped += 1;
    }
  }

  getStrategyLogger().info({ component: "settle_service", settled, skipped, total: signals.length }, "settleSignals completed");
  return { settled, skipped };
};
