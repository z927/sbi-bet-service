import type { Statistics } from "../../scraper/models.ts";
import type { Alert } from "../signals/alert.ts";

export interface StrategyContext {
  sport?: number;
}

export interface StrategyMatchResult {
  matchId: string;
  home: string;
  away: string;
  statistics: Statistics | null;
  alerts: Alert[];
  error: string | null;
}

export interface StrategyResult {
  name: string;
  matches: number;
  enriched: number;
  failures: number;
  results: StrategyMatchResult[];
}

export interface Strategy {
  readonly name: string;
  run(context?: StrategyContext): Promise<StrategyResult>;
}
