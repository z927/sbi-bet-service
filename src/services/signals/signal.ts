import type { Match, Statistics } from "../../scraper/models.ts";
import type { Alert } from "./alert.ts";

export interface Signal {
  readonly name: string;
  evaluate(match: Match, statistics: Statistics): Alert | null;
}
