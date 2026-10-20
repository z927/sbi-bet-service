import type { Match } from "../../scraper/models.ts";

const FIRST_HALF_STAGE = 12;
const SECOND_HALF_STAGE = 13;
const HALFTIME_OR_LATER = new Set([6, 7, 10, 11, 13, 38, 39]);
const FIRST_HALF_MINUTES = 45;
const SECOND_HALF_OFFSET = 45;

export type MatchPeriod = "first_half" | "second_half";

export const matchPeriod = (match: Match): MatchPeriod | null => {
  if (match.stage_id === FIRST_HALF_STAGE) {
    return "first_half";
  }
  if (match.stage_id === SECOND_HALF_STAGE) {
    return "second_half";
  }
  return null;
}

export const matchMinute = (match: Match, now = Date.now() / 1000): number | null => {
  const stage = match.stage_id;
  const start = match.stage_start;
  if (!start) {
    return null;
  }
  if (stage === FIRST_HALF_STAGE) {
    const elapsed = Math.trunc((now - start) / 60) + 1;
    return Math.min(FIRST_HALF_MINUTES, Math.max(1, elapsed));
  }
  if (stage === SECOND_HALF_STAGE) {
    const elapsed = Math.trunc((now - start) / 60) + 1 + SECOND_HALF_OFFSET;
    return Math.min(SECOND_HALF_OFFSET + FIRST_HALF_MINUTES, Math.max(SECOND_HALF_OFFSET + 1, elapsed));
  }
  return null;
}

export const firstHalfMinutes = (match: Match, now = Date.now() / 1000): number | null => {
  const stage = match.stage_id;
  if (stage === null || stage === undefined) {
    return null;
  }
  if (stage === FIRST_HALF_STAGE) {
    const start = match.stage_start;
    if (!start) {
      return null;
    }
    const elapsed = Math.trunc((now - start) / 60) + 1;
    return Math.min(FIRST_HALF_MINUTES, Math.max(1, elapsed));
  }
  if (HALFTIME_OR_LATER.has(stage)) {
    return FIRST_HALF_MINUTES;
  }
  return null;
}

export const secondHalfMinutes = (match: Match, now = Date.now() / 1000): number | null => {
  if (match.stage_id !== SECOND_HALF_STAGE) {
    return null;
  }
  const start = match.stage_start;
  if (!start) {
    return null;
  }
  const elapsed = Math.trunc((now - start) / 60) + 1;
  return Math.min(FIRST_HALF_MINUTES, Math.max(1, elapsed));
}
