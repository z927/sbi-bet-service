import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSettings } from "../config.ts";
import { getStrategyLogger } from "../logger.ts";

export interface SignalItem {
  id: string;
  matchId: string;
  rule: string;
  home: string;
  away: string;
  minute: number | null;
  value: number | null;
  result: "win" | "lose" | null;
  win: boolean | null;
  quota: number | null;
  type: "pre-alert" | "signal" | null;
}

export interface SignalListRow {
  home: string;
  away: string;
  matchId: string;
  tournament: string;
  homeScore: number | null;
  awayScore: number | null;
  matchDate: string | null;
  win: boolean | null;
}

export interface SignalRecap {
  totalCount: number;
  loseCount: number;
  winCount: number;
  percentageWin: string;
  percentageLose: string;
  averageOdd: number;
}

export interface SignalsResponse {
  recap: SignalRecap;
  signals: SignalListRow[];
}

const signals: SignalItem[] = [];

const roundTwo = (value: number): number => Math.round(value * 100) / 100;

let client: SupabaseClient | null = null;
let clientResolved = false;

const getClient = (): SupabaseClient | null => {
  if (clientResolved) {
    return client;
  }
  clientResolved = true;
  const settings = getSettings();
  const url = settings.supabaseUrl;
  const key = settings.supabaseServiceRoleKey;
  if (!url || !key) {
    return null;
  }
  client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return client;
};

export const addSignal = (signal: SignalItem): void => {
  signals.push(signal);
};

export const setSignals = (next: readonly SignalItem[]): void => {
  signals.length = 0;
  signals.push(...next);
};

export const getSignals = (): readonly SignalItem[] => {
  return [...signals];
};

export const reset = (): void => {
  signals.length = 0;
};

const toSignalListRow = (row: {
  home?: string | null;
  away?: string | null;
  match_id?: string | null;
  tournament?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  created_at?: string | null;
  win?: boolean | null;
}): SignalListRow => ({
  home: row.home ?? "",
  away: row.away ?? "",
  matchId: row.match_id ?? "",
  tournament: row.tournament ?? "",
  homeScore: row.home_score ?? null,
  awayScore: row.away_score ?? null,
  matchDate: row.created_at ?? null,
  win: row.win ?? null,
});

export const getSignalStats = async (filter?: { from?: string; to?: string }): Promise<SignalsResponse> => {
  getStrategyLogger().info({ component: "signals_service" }, "getSignalStats called");
  const supabase = getClient();
  if (supabase) {
    try {
      getStrategyLogger().info({ component: "signals_service", source: "supabase" }, "reading signals from supabase");
      const { data, error } = await supabase.from("signals").select("*");
      if (error) {
        getStrategyLogger().error({ err: error, component: "signals_service" }, "supabase select failed");
        throw error;
      }
      const rows = (data ?? []) as unknown as {
        home?: string | null;
        away?: string | null;
        match_id?: string | null;
        tournament?: string | null;
        home_score?: number | null;
        away_score?: number | null;
        created_at?: string | null;
        win?: boolean | null;
        result?: string | null;
        quota?: number | null;
      }[];
      getStrategyLogger().info({ component: "signals_service", source: "supabase", rowsRead: rows.length }, "supabase select completed");
      const { from, to } = filter ?? {};
      const filteredRows = rows.filter((r) => isDateInRange(r.created_at ?? null, from, to));
      const signalsList = filteredRows.map(toSignalListRow).sort(sortByMatchDateDesc);
      const recap = buildRecap(filteredRows);
      const response: SignalsResponse = { recap, signals: signalsList };
      getStrategyLogger().info({ component: "signals_service", source: "supabase", recap, filtered: filteredRows.length }, "signals returned from supabase");
      return response;
    } catch (exc) {
      getStrategyLogger().error({ err: exc, component: "signals_service" }, "signals read failed");
    }
  }

  getStrategyLogger().info({ component: "signals_service", source: "memory" }, "reading signals from in-memory store");
  const { from, to } = filter ?? {};
  const signalsList = signals
    .filter(() => isDateInRange(null, from, to))
    .map((s) => ({
      home: s.home,
      away: s.away,
      matchId: s.matchId,
      tournament: "",
      homeScore: null,
      awayScore: null,
      matchDate: null,
      win: s.win,
    }))
    .sort(sortByMatchDateDesc);
  const recap = buildRecapFromMemory(signals.filter(() => isDateInRange(null, from, to)));
  const response: SignalsResponse = { recap, signals: signalsList };
  getStrategyLogger().info({ component: "signals_service", source: "memory", recap }, "signals returned from memory");
  return response;
};

const sortByMatchDateDesc = (a: SignalListRow, b: SignalListRow): number => {
  if (a.matchDate === null && b.matchDate === null) {
    return 0;
  }
  if (a.matchDate === null) {
    return 1;
  }
  if (b.matchDate === null) {
    return -1;
  }
  if (a.matchDate > b.matchDate) {
    return -1;
  }
  if (a.matchDate < b.matchDate) {
    return 1;
  }
  return 0;
};

const isDateInRange = (value: string | null, from?: string, to?: string): boolean => {
  if (from === undefined && to === undefined) {
    return true;
  }
  if (!value) {
    return false;
  }
  const day = value.slice(0, 10);
  if (from !== undefined && day < from) {
    return false;
  }
  if (to !== undefined && day > to) {
    return false;
  }
  return true;
};

const buildRecap = (rows: {
  home?: string | null;
  away?: string | null;
  match_id?: string | null;
  tournament?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  win?: boolean | null;
  result?: string | null;
  quota?: number | null;
}[]): SignalRecap => {
  const totalCount = rows.length;
  const winCount = rows.filter((r) => r.win === true || (r.win === null && r.result === "win")).length;
  const loseCount = rows.filter((r) => r.win === false || (r.win === null && r.result === "lose")).length;
  const quotas = rows.filter((r) => r.quota !== null && r.quota !== undefined && Number.isFinite(r.quota as number)).map((r) => r.quota as number);
  const averageOdd = quotas.length > 0 ? roundTwo(quotas.reduce((a, b) => a + b, 0) / quotas.length) : 0;
  const percentageWin = totalCount > 0 ? `${roundTwo((winCount / totalCount) * 100)}%` : "";
  const percentageLose = totalCount > 0 ? `${roundTwo((loseCount / totalCount) * 100)}%` : "";
  return { totalCount, loseCount, winCount, percentageWin, percentageLose, averageOdd };
};

const buildRecapFromMemory = (items: SignalItem[]): SignalRecap => {
  const totalCount = items.length;
  const winCount = items.filter((s) => s.win === true || (s.win === null && s.result === "win")).length;
  const loseCount = items.filter((s) => s.win === false || (s.win === null && s.result === "lose")).length;
  const quotas = items.filter((s) => s.quota !== null && s.quota !== undefined && Number.isFinite(s.quota as number)).map((s) => s.quota as number);
  const averageOdd = quotas.length > 0 ? roundTwo(quotas.reduce((a, b) => a + b, 0) / quotas.length) : 0;
  const percentageWin = totalCount > 0 ? `${roundTwo((winCount / totalCount) * 100)}%` : "";
  const percentageLose = totalCount > 0 ? `${roundTwo((loseCount / totalCount) * 100)}%` : "";
  return { totalCount, loseCount, winCount, percentageWin, percentageLose, averageOdd };
};
