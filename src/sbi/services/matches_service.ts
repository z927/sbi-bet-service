import { baseResponse } from "../../errors.ts";
import type { BaseResponse, MatchModel } from "../../types.ts";

let matches: MatchModel[] = [];

export function getScheduledFixtures(): BaseResponse {
  return baseResponse("Scheduled fixtures refresh triggered", 200);
}

export function getMatches(day?: string): MatchModel[] {
  if (day === undefined) {
    return [...matches];
  }
  return matches.filter((m) => (m.startTime ?? "").startsWith(day));
}

export function setMatches(next: MatchModel[]): void {
  matches = [...next];
}

export function reset(): void {
  matches = [];
}
