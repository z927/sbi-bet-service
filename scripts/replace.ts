import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://www.diretta.it";
const feedUrl = BASE + "/x/feed/f_1_0_3_it_1";
const res = await fetch(feedUrl, {
  headers: { "x-fsign": "SW9D1eZo", "User-Agent": "Mozilla/5.0", Accept: "*/*", Referer: BASE + "/" },
});
const text = await res.text();
const names = new Set<string>();
for (const chunk of text.split("~")) {
  for (const part of chunk.split("¬")) {
    const idx = part.indexOf("÷");
    if (idx >= 0) {
      const k = part.slice(0, idx);
      const v = part.slice(idx + "÷".length);
      if (k === "AE" || k === "AF") names.add(v);
    }
  }
}
const direttaNames = [...names];

const levenshtein = (a: string, b: string) => {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  return dp[m][n];
};

const nearest = (name: string) => {
  let best = { n: null as string | null, d: Infinity };
  for (const n of direttaNames) {
    const d = levenshtein(name.toLowerCase(), n.toLowerCase());
    if (d < best.d) best = { n, d };
  }
  return best;
};

const data = JSON.parse(readFileSync(join(process.cwd(), "src/res/teams.json"), "utf8")) as { teams: { apiFootball: string; sofascore: string }[] };
const out = data.teams.map((t) => {
  const { n } = nearest(t.sofascore);
  return { apiFootball: t.apiFootball, diretta: n };
});
writeFileSync(join(process.cwd(), "src/res/teams.diretta.json"), JSON.stringify({ teams: out }, null, 2));
console.log("written", out.length);
