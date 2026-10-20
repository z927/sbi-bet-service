import type { Match } from "../../scraper/models.ts";

export const MAJOR_LEAGUES_ENV = "MONITOR_MAJOR_LEAGUES";

export const DEFAULT_MAJOR_LEAGUES: readonly string[] = [
  // Austria
  "AUSTRIA: Bundesliga",
  // Belgio
  "BELGIO: Jupiler League", // ex "Jupiler Pro League"
  "BELGIO: Challenger Pro League",
  // Repubblica Ceca
  "REPUBBLICA CECA: 1. Liga", // "Czech Liga"
  // Danimarca
  "DANIMARCA: Superliga",
  // Inghilterra
  "INGHILTERRA: Community Shield", // migliore stima (fuori stagione)
  "INGHILTERRA: Premier League",
  "INGHILTERRA: League One",
  "INGHILTERRA: Championship",
  "INGHILTERRA: FA Cup",
  // Francia
  "FRANCIA: Coupe de France",
  "FRANCIA: Coppa di Francia", // backup variante italiana
  "FRANCIA: Ligue 1",
  "FRANCIA: Ligue 2",
  "FRANCIA: Ligue 3", // ex "National 1" (rinominata 2026-27)
  "FRANCIA: National 1", // backup
  // Germania
  "GERMANIA: DFB Pokal",
  "GERMANIA: 2. Bundesliga",
  "GERMANIA: Bundesliga",
  // Irlanda
  "IRLANDA: Irish Premier Division",
  "IRLANDA: Premier Division", // backup
  // Italia
  "ITALIA: Serie A",
  "ITALIA: Serie B",
  "ITALIA: Coppa Italia",
  // Paesi Bassi
  "OLANDA: Eredivisie",
  "OLANDA: Eerste Divisie",
  "OLANDA: KNVB Beker",
  // Portogallo
  "PORTOGALLO: Liga Portugal", // ex "Primeira Liga"
  "PORTOGALLO: Primeira Liga", // backup
  "PORTOGALLO: Liga Portugal 2", // ex "Segunda Liga"
  "PORTOGALLO: Segunda Liga", // backup
  // Romania
  "ROMANIA: Superliga", // "Liga I"
  // Scozia
  "SCOZIA: Premiership",
  // Serbia
  "SERBIA: Super Liga",
  // Spagna
  "SPAGNA: LaLiga",
  "SPAGNA: LaLiga2",
  "SPAGNA: Copa del Rey",
  // Svizzera
  "SVIZZERA: Super League",
  "SVIZZERA: Coppa di Svizzera",
  // Turchia
  "TURCHIA: 1. Lig",
  // UEFA / internazionali (verificato: prefisso EUROPA, non MONDO)
  "EUROPA: Champions League",
  "EUROPA: Champions League - Prima fase", // verifica feed 20/10/2026: suffisso "Prima fase" in league phase
  "EUROPA: UEFA Champions League", // backup
  "EUROPA: Europa League",
  "EUROPA: Europa League - Prima fase", // verifica feed 20/10/2026
  "EUROPA: UEFA Europa League", // backup
  "EUROPA: Conference League",
  "EUROPA: Conference League - Prima fase", // verifica feed 20/10/2026
  "EUROPA: UEFA Europa Conference League", // backup
  "EUROPA: Nations League", // non verificabile (finestra internazionale)
  "MONDO: Nations League", // backup
  "EUROPA: World Cup - Qualification Europe", // non verificabile
  "MONDO: World Cup - Qualification Europe", // backup
];

export const configuredMajorLeagues = (env: NodeJS.ProcessEnv = process.env): string[] => {
  const raw = env[MAJOR_LEAGUES_ENV];
  if (raw === undefined || raw.trim() === "") {
    return [...DEFAULT_MAJOR_LEAGUES];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export const isMajorLeague = (match: Match, allowlist: readonly string[]): boolean => {
  const name = (match.tournament ?? "").trim().toLowerCase();
  const id = (match.tournament_id ?? "").trim().toLowerCase();
  return allowlist.some((entry) => {
    const value = entry.trim().toLowerCase();
    return value !== "" && (name === value || id === value);
  });
}
