import { baseResponse } from "../errors.ts";
import type { BaseResponse, MonitoredFixture } from "../types.ts";
import { runLiveMatchesStrategy } from "./strategies/index.ts";
import {
  getScheduledFixtures,
  type ScheduledFixture,
} from "./scheduled_fixtures_repo.ts";

export const monitorFixtures = async (): Promise<BaseResponse> => {
  const result = await runLiveMatchesStrategy();
  return baseResponse(
    `Monitored ${result.enriched}/${result.matches} live fixtures (${result.failures} failures)`,
    200,
  );
}

export const restoreFixtures = (day?: string): BaseResponse => {
  const suffix = day ? ` for ${day}` : "";
  return baseResponse(`Restore requested${suffix}`, 200);
}

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

const isToday = (kickoffTime: string): boolean => kickoffTime.slice(0, 10) === todayUtc();

const splitLeague = (value: string): { country: string; name: string } => {
  const parts = value.split(": ");
  if (parts.length > 1) {
    return { country: parts[0] ?? "", name: parts.slice(1).join(": ") };
  }
  return { country: "", name: value };
};

const pad = (n: number): string => String(n).padStart(2, "0");

const formatDay = (d: Date): string => `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;

const formatDayTime = (iso: string): string => {
  const d = new Date(iso);
  return `${formatDay(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

const toMonitoredFixture = (f: ScheduledFixture): MonitoredFixture => ({
  fixtureId: f.fixture_id,
  league: splitLeague(f.api_football_league_name).name,
  homeTeam: f.home_team,
  awayTeam: f.away_team,
  startTime: formatDay(new Date(f.kickoff_time)),
  beginMonitoringTime: formatDayTime(f.begin_monitoring_time),
  endMonitoringTime: formatDayTime(f.end_monitoring_time),
  info: f.status,
});

export const getMonitoredFixtures = async (): Promise<MonitoredFixture[]> => {
  const fixtures = await getScheduledFixtures();
  return fixtures.filter((f) => isToday(f.kickoff_time)).map(toMonitoredFixture);
}

export const reset = (): void => {
  // no-op: monitored fixtures are now sourced from scheduled_fixtures
}
