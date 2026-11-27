export const normalizeTeamName = (name: string | null | undefined): string => {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

export const teamKey = (home: string | null | undefined, away: string | null | undefined): string => {
  return `${normalizeTeamName(home)}|${normalizeTeamName(away)}`;
};
