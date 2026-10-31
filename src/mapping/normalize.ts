import type { Team, TeamCandidate, TeamWithAliases } from "./models.ts";

const DIACRITICS = /\p{Diacritic}/gu;
const NON_ALNUM = /[^a-z0-9]+/g;

const STOPWORDS = new Set([
  "fc",
  "cf",
  "afc",
  "ac",
  "as",
  "ss",
  "ssc",
  "sc",
  "us",
  "ud",
  "cd",
  "ca",
  "sd",
  "club",
  "calcio",
  "football",
  "futbol",
  "futebol",
  "sport",
  "sports",
  "team",
  "the",
]);

const tokenize = (value: string): string[] => {
  const normalized = value
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(NON_ALNUM, " ")
    .trim();
  if (normalized === "") {
    return [];
  }
  return normalized.split(/\s+/).filter((token) => token !== "");
};

export const normalizeTeamName = (value: string): string => {
  const tokens = tokenize(value);
  const significant = tokens.filter((token) => !STOPWORDS.has(token));
  return (significant.length > 0 ? significant : tokens).join(" ");
};

export const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      const cost = a.charAt(i) === b.charAt(j) ? 0 : 1;
      const insertion = (current[j] ?? 0) + 1;
      const deletion = (previous[j + 1] ?? 0) + 1;
      const substitution = (previous[j] ?? 0) + cost;
      current.push(Math.min(insertion, deletion, substitution));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
};

const diceCoefficient = (a: string[], b: string[]): number => {
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const token of a) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  let overlap = 0;
  for (const token of b) {
    const available = counts.get(token) ?? 0;
    if (available > 0) {
      overlap += 1;
      counts.set(token, available - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
};

export const similarity = (left: string, right: string): number => {
  const a = normalizeTeamName(left);
  const b = normalizeTeamName(right);
  if (a === "" || b === "") return 0;
  if (a === b) return 1;

  const dice = diceCoefficient(a.split(" "), b.split(" "));
  const compactA = a.replace(/\s+/g, "");
  const compactB = b.replace(/\s+/g, "");
  const distance = levenshtein(compactA, compactB);
  const ratio = 1 - distance / Math.max(compactA.length, compactB.length);

  let score = Math.max(dice, ratio);
  if (compactA.includes(compactB) || compactB.includes(compactA)) {
    score = Math.max(score, 0.85);
  }
  return Math.round(score * 1000) / 1000;
};

export const scoreTeam = (input: string, entry: TeamWithAliases): number => {
  let best = similarity(input, entry.team.name);
  for (const alias of entry.aliases) {
    best = Math.max(best, similarity(input, alias));
  }
  return best;
};

export const rankCandidates = (
  input: string,
  teams: TeamWithAliases[],
  threshold: number,
  limit = 5,
): TeamCandidate[] => {
  return teams
    .map((entry) => ({ team: entry.team, confidence: scoreTeam(input, entry) }))
    .filter((candidate) => candidate.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence || a.team.name.localeCompare(b.team.name))
    .slice(0, limit);
};

export const teamWithAliases = (team: Team, aliases: string[]): TeamWithAliases => ({ team, aliases });
