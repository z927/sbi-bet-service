export interface Alert {
  rule: string;
  matchId: string;
  home: string;
  away: string;
  minute: number | null;
  value: number | null;
  threshold: number;
  text: string;
}
