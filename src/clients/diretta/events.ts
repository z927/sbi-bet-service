import { fetchRaw, FIELD_SEP, KV_SEP, RECORD_SEP, toInt, type FeedRecord } from "./transport.ts";

const INCIDENT_TYPES: Record<number, string> = {
  1: "CARTELLINO_GIALLO",
  2: "CARTELLINO_ROSSO",
  3: "GOL",
  4: "AUTOGOL",
  5: "RIGORE",
  6: "SOSTITUZIONE_OUT",
  7: "SOSTITUZIONE_IN",
  8: "ASSIST",
  9: "SOSPENSIONE",
  10: "RIGORE_SEGNATO",
  11: "RIGORE_SBAGLIATO",
  22: "CARTELLINI_ROSSI",
  23: "CARTELLINI_GIALLO",
};

export const getEvents = async (matchId: string): Promise<unknown[]> => {
  const raw = await fetchRaw(`df_sui_1_${matchId}`);
  const events: unknown[] = [];
  let period: string | null = null;
  for (const chunk of raw.split(RECORD_SEP)) {
    const tokens: Array<[string, string]> = [];
    for (const part of chunk.split(FIELD_SEP)) {
      const idx = part.indexOf(KV_SEP);
      if (idx >= 0) {
        tokens.push([part.slice(0, idx), part.slice(idx + KV_SEP.length)]);
      }
    }
    const keys = new Set(tokens.map(([k]) => k));
    if (!keys.has("III")) {
      for (const [key, value] of tokens) {
        if (key === "AC") {
          period = value;
        }
      }
      continue;
    }
    const row: FeedRecord = {};
    for (const [key, value] of tokens) {
      if (key === "IA" || key === "IB" || key === "INX" || key === "IOX") {
        row[key] = value;
      }
    }
    const side = toInt(row["IA"]);
    const minute = row["IB"] ?? null;
    const homeScore = toInt(row["INX"]);
    const awayScore = toInt(row["IOX"]);
    const incidents: Array<Record<string, string | number | null>> = [];
    let current: Record<string, string | number | null> | null = null;
    for (const [key, value] of tokens) {
      if (key === "IE") {
        current = { type_code: toInt(value) };
        incidents.push(current);
      } else if ((key === "IF" || key === "IK" || key === "IM" || key === "IU") && current !== null) {
        current[key] = value;
      }
    }
    for (const incident of incidents) {
      const typeName = (incident["IK"] as string | undefined) ?? null;
      const typeCode = incident["type_code"];
      events.push({
        minute,
        period,
        side: side === 1 ? "home" : side === 2 ? "away" : null,
        type:
          typeCode !== null && typeCode !== undefined
            ? (INCIDENT_TYPES[typeCode as number] ?? typeName ?? "")
            : (typeName ?? ""),
        type_name: typeName,
        player: incident["IF"] ?? null,
        player_id: (incident["IM"] as string | undefined) ?? "",
        score: homeScore !== null && awayScore !== null ? `${homeScore}-${awayScore}` : null,
      });
    }
  }
  return events;
}
