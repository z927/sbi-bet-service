import { baseResponse } from "../errors.ts";
import type { BaseResponse, MatchModel } from "../types.ts";

let matches: MatchModel[] = [];

export const getScheduledFixtures = (): BaseResponse => {
  return baseResponse("Scheduled fixtures refresh triggered", 200);
}

export const getMatches = (day?: string): MatchModel[] => {
  if (day === undefined) {
    return [...matches];
  }
  return matches.filter((m) => (m.startTime ?? "").startsWith(day));
}

export const setMatches = (next: MatchModel[]): void => {
  matches = [...next];
}

export const reset = (): void => {
  matches = [];
}
