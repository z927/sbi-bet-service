import { baseResponse } from "../errors.ts";
import type { BaseResponse, FixtureDto } from "../types.ts";

const monitored = new Map<number, FixtureDto>();

export const monitorFixtures = (fixtures: FixtureDto[]): BaseResponse => {
  for (const fixture of fixtures) {
    if (fixture.fixtureId !== undefined && fixture.fixtureId !== null) {
      monitored.set(fixture.fixtureId, fixture);
    }
  }
  return baseResponse(`Monitoring ${monitored.size} fixtures`, 200);
}

export const restoreFixtures = (day?: string): BaseResponse => {
  const suffix = day ? ` for ${day}` : "";
  return baseResponse(`Restore requested${suffix}`, 200);
}

export const getMonitoredFixtures = (): FixtureDto[] => {
  return [...monitored.values()];
}

export const reset = (): void => {
  monitored.clear();
}
