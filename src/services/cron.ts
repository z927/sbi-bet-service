export interface MonitoringWindow {
  /** Epoch seconds: begin of the monitoring window. */
  begin: number;
  /** Epoch seconds: end of the monitoring window. */
  end: number;
}

const timeFormatter = (timeZone: string): Intl.DateTimeFormat => {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

const dayFormatter = (timeZone: string): Intl.DateTimeFormat => {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit" });
}

const weekdayFormatter = (timeZone: string): Intl.DateTimeFormat => {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" });
}

const parts = (formatter: Intl.DateTimeFormat, date: Date): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    result[part.type] = part.value;
  }
  return result;
}

const hourRange = (beginHour: number, endHour: number): string => {
  if (beginHour === endHour) {
    return String(beginHour);
  }
  return `${beginHour}-${endHour}`;
}

/**
 * Builds a GCP Cloud Scheduler cron expression
 * ("minute hour day-of-month month day-of-week") in the requested format:
 *
 *   "STEP {ranges} {dom} {mon} {DOW}"   e.g. star-slash-10 15-17,18-20 18 10 SUN
 *
 * - The minute field is a fixed step (star-slash-N, e.g. every 10 minutes).
 * - The hour field holds one range per monitoring window
 *   ([beginMonitoring → endMonitoring], local hours), identical ranges deduped,
 *   overlapping ranges kept separate. Windows crossing midnight are clamped to
 *   the current day (23). Fully past windows are dropped.
 * - Day-of-month and month are pinned to `now` in `timeZone`; the day-of-week is
 *   the weekday of `now` (SUN..SAT). Note: GCP evaluates dom and dow with OR —
 *   the daily upsert of the job keeps this harmless in practice.
 *
 * Returns null when no window remains.
 */
export const buildCron = (
  windows: MonitoringWindow[],
  timeZone: string,
  now: Date,
  stepMinutes: number,
): string | null => {
  const nowMs = now.getTime();
  const timeFmt = timeFormatter(timeZone);
  const ranges: string[] = [];
  const seen = new Set<string>();
  for (const window of windows) {
    if (!Number.isFinite(window.begin) || !Number.isFinite(window.end) || window.end * 1000 <= nowMs) {
      continue;
    }
    const beginHour = Number(parts(timeFmt, new Date(window.begin * 1000))["hour"]);
    let endHour = Number(parts(timeFmt, new Date(window.end * 1000))["hour"]);
    if (endHour < beginHour) {
      endHour = 23;
    }
    const range = hourRange(beginHour, endHour);
    if (!seen.has(range)) {
      seen.add(range);
      ranges.push(range);
    }
  }
  if (ranges.length === 0) {
    return null;
  }
  const today = parts(dayFormatter(timeZone), now);
  const weekday = parts(weekdayFormatter(timeZone), now)["weekday"]!.toUpperCase();
  const step =
    Number.isFinite(stepMinutes) && stepMinutes >= 1 && stepMinutes <= 59
      ? Math.trunc(stepMinutes)
      : 10;
  return `*/${step} ${ranges.join(",")} ${Number(today["day"])} ${Number(today["month"])} ${weekday}`;
}

const fieldMatches = (field: string, value: string): boolean => {
  if (field === "*") {
    return true;
  }
  return field.split(",").some((entry) => Number(entry) === Number(value));
}

/**
 * True when a cron built by `buildCron` (5 fields, day-of-month + month pinned)
 * fires on the calendar day of `day` in `timeZone`.
 */
export const cronHitsDay = (cron: string, timeZone: string, day: Date): boolean => {
  const fields = cron.trim().split(/\s+/);
  if (fields.length < 5) {
    return false;
  }
  const today = parts(dayFormatter(timeZone), day);
  return fieldMatches(fields[2]!, today["day"]!) && fieldMatches(fields[3]!, today["month"]!);
}
