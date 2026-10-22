import { DatabaseSync } from "node:sqlite";
import { createClient } from "@supabase/supabase-js";

const sqlitePath = process.env.DIRETTA_DB_SQLITE || "./data/diretta.db";
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const conn = new DatabaseSync(sqlitePath);
const rows = conn.prepare("SELECT * FROM matches").all();
console.log(`Found ${rows.length} matches in SQLite`);

for (const row of rows) {
  const match = JSON.parse(row.data);
  const { error } = await supabase.from("matches").upsert({
    id: row.id,
    sport: row.sport,
    tournament: row.tournament,
    country: row.country,
    home: row.home,
    away: row.away,
    home_score: row.home_score,
    away_score: row.away_score,
    status: row.status,
    status_code: row.status_code,
    stage_id: row.stage_id,
    is_live: row.is_live === 1,
    minute: row.minute,
    start_time: row.start_time,
    data: match,
    updated_at: row.updated_at,
  }, { onConflict: "id" });
  if (error) console.error("match error", row.id, error.message);
}

const snapshots = conn.prepare("SELECT * FROM snapshots").all();
console.log(`Found ${snapshots.length} snapshots in SQLite`);
for (const s of snapshots) {
  const { error } = await supabase.from("snapshots").insert({
    match_id: s.match_id,
    home_score: s.home_score,
    away_score: s.away_score,
    status_code: s.status_code,
    stage_id: s.stage_id,
    minute: s.minute,
    captured_at: s.captured_at,
  });
  if (error && !error.message.includes("duplicate")) console.error("snap error", error.message);
}

conn.close();
console.log("Done");
