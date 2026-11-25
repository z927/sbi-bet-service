import { listTodayFixtures, getFixtureEvents, type ApiFootballFixture } from "../../services/api_football.ts";
import { getSettings } from "../../config.ts";
import { getStrategyLogger } from "../../logger.ts";
import { loadTeamMapping } from "../../services/team_mapping.ts";
import * as signalsRepo from "./repo.ts";
import type { UnsettledSignal } from "./repo.ts";

export interface SettleResult {
  settled: number;
  preAlertsSettled: number;
  signalsSettled: number;
  skipped: number;
  skippedDetails: Array<{ matchId: string; reason: string; fixtureId?: number | null }>;
}

export interface SettleParams {
  from?: string;
  to?: string;
}

const GOAL_OVER_SIGNAL = "goal-over-0.5";

const normalizeName = (name: string): string => name.trim().toLowerCase();

type TeamMapping = import("../../services/team_mapping.ts").TeamMapping;

const addDays = (date: string, days: number): string => {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const resolveApiName = (mapping: TeamMapping[], direttaName: string): string => {
  const m = mapping.find((mm) => normalizeName(mm.direttaName) === normalizeName(direttaName));
  return m ? m.apiFootballName : direttaName;
};

const isHalftimeRule = (text: string | null): boolean => {
  if (!text) return false;
  return text.includes("Alert Goal Over 0.5 HT");
};

const findFixture = (
  fixtures: ApiFootballFixture[],
  directHome: string | null,
  directAway: string | null,
  mapping: TeamMapping[],
): ApiFootballFixture | null => {
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
      return f;
    }
  }
  return null;
};

const selectFulltimeScore = (fixture: ApiFootballFixture): { homeGoals: number; awayGoals: number } | null => {
  const score = fixture.score.fulltime;
  if (score.home === null || score.away === null) {
    return null;
  }
  return { homeGoals: score.home, awayGoals: score.away };
};

const selectHalftimeScore = (fixture: ApiFootballFixture): { homeGoals: number; awayGoals: number } | null => {
  const score = fixture.score.halftime;
  if (score.home === null || score.away === null) {
    return null;
  }
  return { homeGoals: score.home, awayGoals: score.away };
};

const firstGoalMinute = async (fixtureId: number): Promise<number | null> => {
  const events = await getFixtureEvents(fixtureId);
  const goals = events
    .filter((e) => e.type === "Goal" && e.time.elapsed != null)
    .sort((a, b) => (a.time.elapsed ?? 0) - (b.time.elapsed ?? 0));
  return goals.length > 0 ? goals[0]!.time.elapsed ?? null : null;
};

const evaluateWin = (rule: string | null, homeGoals: number, awayGoals: number): boolean | null => {
  if (rule === GOAL_OVER_SIGNAL) {
    return homeGoals + awayGoals >= 1;
  }
  return null;
};

export const settleSignals = async (params: SettleParams = {}): Promise<SettleResult> => {
  const settings = getSettings();
  const today = new Date().toISOString().slice(0, 10);
  const from = params.from ?? today;
  const to = params.to ?? today;

  getStrategyLogger().info({ component: "settle_service", from, to }, "settleSignals called");

  const mapping = loadTeamMapping();

  const dates: string[] = [];
  let d = from;
  while (d <= to) {
    dates.push(d);
    d = addDays(d, 1);
  }

  const fixtureBatches: ApiFootballFixture[][] = [];
  for (const date of dates) {
    try {
      const batch = await listTodayFixtures(date);
      fixtureBatches.push(batch);
    } catch (exc) {
      getStrategyLogger().error({ err: exc, component: "settle_service", date }, "fixtures fetch failed for date");
    }
  }
  const fixtures = fixtureBatches.flat();

  const fixturesById = new Map(fixtures.map((f) => [f.fixture.id, f]));

  const signals = await signalsRepo.getUnsettledSignals();
  if (!signals) {
    return { settled: 0, preAlertsSettled: 0, signalsSettled: 0, skipped: 0, skippedDetails: [] };
  }

  let settled = 0;
  let preAlertsSettled = 0;
  let signalsSettled = 0;
  let skipped = 0;
  const skippedDetails: Array<{ matchId: string; reason: string; fixtureId?: number | null }> = [];

  for (const signal of signals) {
    const isPreAlert = signal.type === "pre-alert";
    let homeGoals: number | null = null;
    let awayGoals: number | null = null;
    let fixture: ApiFootballFixture | null = null;

    if (signal.fixture_id != null) {
      fixture = fixturesById.get(signal.fixture_id) ?? null;
      if (!fixture) {
        skipped += 1;
        skippedDetails.push({
          matchId: signal.match_id,
          reason: `fixture_not_found_by_id (fixture_id=${signal.fixture_id})`,
          fixtureId: signal.fixture_id,
        });
        continue;
      }
    } else {
      fixture = findFixture(fixtures, signal.home, signal.away, mapping);
      if (!fixture) {
        skipped += 1;
        skippedDetails.push({
          matchId: signal.match_id,
          reason: `fixture_not_found_by_name (home=${signal.home}, away=${signal.away})`,
          fixtureId: null,
        });
        continue;
      }
    }

    const fulltime = selectFulltimeScore(fixture);
    if (!fulltime) {
      skipped += 1;
      skippedDetails.push({
        matchId: signal.match_id,
        reason: "score_null (fulltime)",
        fixtureId: fixture?.fixture.id ?? null,
      });
      continue;
    }
    homeGoals = fulltime.homeGoals;
    awayGoals = fulltime.awayGoals;

    const halftime = selectHalftimeScore(fixture);
    const scoreForWin = isHalftimeRule(signal.text) ? halftime : fulltime;
    const win = scoreForWin ? evaluateWin(signal.rule, scoreForWin.homeGoals, scoreForWin.awayGoals) : null;

    const goalMinute = await firstGoalMinute(fixture.fixture.id);

    try {
      const homeScoreHt = fixture.score.halftime.home ?? null;
      const awayScoreHt = fixture.score.halftime.away ?? null;
      await signalsRepo.updateSignalResult(signal.match_id, {
        homeScore: homeGoals,
        awayScore: awayGoals,
        ...(win !== null ? { win } : {}),
        homeScoreHt,
        awayScoreHt,
        goalMinute,
      });
      settled += 1;
      if (isPreAlert) {
        preAlertsSettled += 1;
      } else {
        signalsSettled += 1;
      }
      getStrategyLogger().info(
        {
          component: "settle_service",
          matchId: signal.match_id,
          home: signal.home,
          away: signal.away,
          homeGoals,
          awayGoals,
          win,
          rule: signal.rule,
          type: signal.type,
          goalMinute,
        },
        signal.type === "pre-alert" ? "pre-alert settled" : "signal settled",
      );
    } catch (exc) {
      getStrategyLogger().error({ err: exc, component: "settle_service", matchId: signal.match_id }, "signal update failed");
      skipped += 1;
      skippedDetails.push({
        matchId: signal.match_id,
        reason: "update_failed",
        fixtureId: fixture?.fixture.id ?? null,
      });
    }
  }

  getStrategyLogger().info(
    { component: "settle_service", settled, preAlertsSettled, signalsSettled, skipped, total: signals.length },
    "settleSignals completed",
  );
  return { settled, preAlertsSettled, signalsSettled, skipped, skippedDetails };
};
