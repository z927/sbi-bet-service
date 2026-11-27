import type { MatchModel } from "../models/types.ts";

let matches: MatchModel[] = [];

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
