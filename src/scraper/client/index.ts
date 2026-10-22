export { BASE_URL, FeedError, httpGet } from "./transport.ts";
export { SPORTS, feedName, liveMinute } from "./matches.ts";

import { listMatches } from "./matches.ts";
import { getMatch } from "./match.ts";
import { getStatistics } from "./statistics.ts";
import { getEvents } from "./events.ts";
import { getLineups } from "./lineups.ts";
import { getOdds, getLiveOddsMenu, getLiveOdds, getLiveOddsOffers } from "./odds.ts";

export const client = {
  listMatches,
  getMatch,
  getStatistics,
  getEvents,
  getLineups,
  getOdds,
  getLiveOddsMenu,
  getLiveOdds,
  getLiveOddsOffers,
};
