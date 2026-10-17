import { baseResponse } from "../errors.ts";
import type { BaseResponse, FixtureDto } from "../types.ts";
import { runLiveMatchesStrategy } from "./strategies/index.ts";

const monitored = new Map<number, FixtureDto>();

export const monitorFixtures = async (_fixtures: FixtureDto[]): Promise<BaseResponse> => {
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

export const getMonitoredFixtures = (): FixtureDto[] => {
  return [...monitored.values()];
}

export const reset = (): void => {
  monitored.clear();
}
