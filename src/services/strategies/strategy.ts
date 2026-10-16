import type { Statistics } from "../../scraper/models.ts";

export interface StrategyContext {
  sport?: number;
}

export interface StrategyMatchResult {
  matchId: string;
  home: string;
  away: string;
  statistics: Statistics | null;
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
