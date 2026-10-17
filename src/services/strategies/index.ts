export {
  LIVE_MATCHES_STRATEGY,
  liveMatchesStrategy,
  runLiveMatchesStrategy,
} from "./live_matches_strategy.ts";
export type { LiveMatchesStrategyHooks } from "./live_matches_strategy.ts";
export type {
  Strategy,
  StrategyContext,
  StrategyMatchResult,
  StrategyResult,
} from "./strategy.ts";
export {
  DEFAULT_MAJOR_LEAGUES,
  MAJOR_LEAGUES_ENV,
  configuredMajorLeagues,
  isMajorLeague,
} from "./major_leagues.ts";
