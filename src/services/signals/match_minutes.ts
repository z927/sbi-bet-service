import type { Match } from "../../scraper/models.ts";

const FIRST_HALF_STAGE = 12;
const HALFTIME_OR_LATER = new Set([6, 7, 10, 11, 13, 38, 39]);
const FIRST_HALF_MINUTES = 45;

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
