import { ConflictError, baseResponse } from "../errors.ts";
import type { BaseResponse, ScheduleRequest } from "../types.ts";

const schedules = new Map<string, ScheduleRequest>();

const localToday = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const scheduleEvents = (request: ScheduleRequest, day?: string): BaseResponse => {
  const targetDay = day ?? localToday();
  if (schedules.has(targetDay)) {
    throw new ConflictError(`Schedule already exists for ${targetDay}`);
  }
  schedules.set(targetDay, request);
  const defaultCount = request.defaultFixtures?.length ?? 0;
  const favouriteCount = request.favouriteFixtures?.length ?? 0;
  return baseResponse(
    `Scheduled ${defaultCount} default and ${favouriteCount} favourite fixtures for ${targetDay}`,
    200,
  );
}

export const reset = (): void => {
  schedules.clear();
}
