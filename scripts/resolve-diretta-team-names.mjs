#!/usr/bin/env node
// Resolves team names against diretta.it across calcio competitions (not just live),
// replacing `sofascore` with `diretta`.
// Input:  {"teams":[{"apiFootball":"...","sofascore":"..."}]}  (stdin or file arg)
// Output: same shape with `diretta` (+ `matchScore`); unresolved get diretta:null.
// Sources: multiple feed windows/sections (FEEDS / DIRETTA_FEEDS env) to span more
// competitions. Coverage depends on what diretta exposes in those feeds at run time;
// it is NOT a full historical catalog of every competition. For broader coverage, run
// repeatedly, extend DIRETTA_FEEDS, or resolve against stored matches/team names.
import { readFileSync } from "node:fs";
import { fetchFeed } from "../src/clients/diretta/transport.ts";

const DIACRITICS = /\p{Diacritic}/gu;
const NON_ALNUM = /[^a-z0-9]+/g;
const STOP = new Set([
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
  "fk",
  "nk",
  "sk",
  "sv",
  "tsv",
  "vfl",
  "vfb",
  "rb",
  "scm",
  "if",
  "bk",
  "af",
  "1",
]);
const B_TEAM =
  /\((?:am|b|ii|u\d+|ng|futuro|riserve|primavera)\)|\b(?:ii|u\d{2}|b team)\b/i;
const norm = (v) => {
  const t = String(v)
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(NON_ALNUM, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const s = t.filter((x) => !STOP.has(x));
  return (s.length ? s : t).join(" ");
};
const sim = (a, b, rawB = "") => {
  const A = norm(a),
    B = norm(b);
  if (!A || !B) return 0;
  if (A === B)
    return B_TEAM.test(rawB) &&
      !B_TEAM.test(String(a)) &&
      A.split(" ").length <= 2
      ? 0.92
      : 1;
  const ca = A.replace(/\s+/g, ""),
    cb = B.replace(/\s+/g, "");
  const as = A.split(" "),
    bs = B.split(" ");
  const set = new Map();
  for (const x of as) set.set(x, (set.get(x) ?? 0) + 1);
  let ov = 0;
  for (const x of bs) {
    const c = set.get(x) ?? 0;
    if (c > 0) {
      ov++;
      set.set(x, c - 1);
    }
  }
  const dice = (2 * ov) / (as.length + bs.length);
  let s = dice;
  const containmentOk =
    ov > 0 &&
    (ca.includes(cb) || cb.includes(ca)) &&
    !(B_TEAM.test(rawB) && !B_TEAM.test(String(a)));
  if (containmentOk) s = Math.max(s, 0.88);
  return s;
};

const FEEDS = (
  process.env.DIRETTA_FEEDS ??
  "f_1_0_3_it_1,f_1_0_2_it_1,f_1_0_1_it_1,f_1_0_4_it_1,f_1_-1_3_it_1"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const file = process.argv[2];
const raw = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
const input = JSON.parse(raw);
console.error(
  `[resolve-diretta] input: ${input.teams?.length ?? 0} team da ${
    file ?? "stdin"
  }, feed=${FEEDS.length}`
);

const names = new Set();
const feedStats = [];
for (const feed of FEEDS) {
  try {
    const records = await fetchFeed(feed);
    console.log(records);
    let added = 0;
    for (const r of records)
      for (const k of ["AE", "AF", "CX", "FH", "FK", "WM", "WN"])
        if (r[k] && !names.has(r[k])) {
          names.add(r[k]);
          added++;
        }
    feedStats.push({ feed, records: records.length, added });
    console.error(
      `[resolve-diretta] feed OK  ${feed}: records=${records.length}, nuovi=${added}, totali=${names.size}`
    );
  } catch (e) {
    feedStats.push({ feed, error: e instanceof Error ? e.message : String(e) });
    console.error(
      `[resolve-diretta] feed ERR ${feed}: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }
}
const all = [...names];

const THRESHOLD = Number(process.env.DIRETTA_MATCH_THRESHOLD ?? "0.78");
console.error(
  `[resolve-diretta] nomi diretta unici=${all.length}, threshold=${THRESHOLD}`
);
const teams = (input.teams ?? []).map((t) => {
  const queries = [t.sofascore, t.apiFootball, t.name, t.diretta].filter(
    Boolean
  );
  let best = null,
    score = 0;
  for (const n of all)
    for (const q of queries) {
      const sc = sim(q, n, n);
      if (sc > score) {
        score = sc;
        best = n;
      }
    }
  const { sofascore, ...rest } = t;
  return {
    ...rest,
    diretta: score >= THRESHOLD ? best : null,
    matchScore: +score.toFixed(3),
  };
});
const unresolved = teams
  .filter((t) => !t.diretta)
  .map((t) => t.apiFootball ?? t.name);
console.error(
  `[resolve-diretta] resolved=${teams.length - unresolved.length}, unresolved=${
    unresolved.length
  }${unresolved.length ? `: ${unresolved.join(" | ")}` : ""}`
);
console.log(
  JSON.stringify(
    {
      resolved: teams.length - unresolved.length,
      unresolved: unresolved.length,
      total: teams.length,
      source: {
        feedCount: FEEDS.length,
        uniqueDirettaNames: all.length,
        feeds: feedStats,
      },
      teams,
      ...(unresolved.length ? { unresolvedNames: unresolved } : {}),
    },
    null,
    2
  )
);
