import type { OddsMarketSelector } from "../../scraper/models.ts";

export interface Alert {
  rule: string;
  matchId: string;
  home: string;
  away: string;
  minute: number | null;
  value: number | null;
  threshold: number;
  text: string;
  tournament?: string;
  country?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  touches?: number | null;
  odds?: number | null;
  oddsMarket?: OddsMarketSelector;
}
