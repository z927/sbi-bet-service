import { readFileSync } from "node:fs";

export interface TeamMapping {
  direttaId?: string;
  direttaName: string;
  apiFootballId?: number;
  apiFootballName: string;
}

export const loadTeamMapping = (path = "data/team_mapping.json"): TeamMapping[] => {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TeamMapping[]) : [];
  } catch {
    return [];
  }
};

export const findMappingByApi = (mapping: TeamMapping[], apiName: string, apiId?: number): TeamMapping | undefined => {
  return mapping.find((m) => {
    if (apiId !== undefined && m.apiFootballId === apiId) return true;
    return m.apiFootballName.toLowerCase() === apiName.toLowerCase();
  });
};
