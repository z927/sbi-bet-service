import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSettings } from "../config.ts";

export interface ScheduledFixture {
  id: string;
  fixture_id: number;
  match_id: string;
  api_football_league_id: number;
  api_football_league_name: string;
  home_team: string;
  away_team: string;
  kickoff_time: string;
  begin_monitoring_time: string;
  end_monitoring_time: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ScheduledFixtureInput {
  fixture_id: number;
  match_id: string;
  api_football_league_id: number;
  api_football_league_name: string;
  home_team: string;
  away_team: string;
  kickoff_time: string;
  begin_monitoring_time: string;
  end_monitoring_time: string;
}

let client: SupabaseClient | null = null;
let useMemory = false;
const memoryFixtures = new Map<number, ScheduledFixture>();

const getClient = (): SupabaseClient => {
  if (client) {
    return client;
  }
  try {
    const settings = getSettings();
    const url = settings.supabaseUrl;
    const key = settings.supabaseServiceRoleKey;
    if (!url || !key) {
      useMemory = true;
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    client = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    return client;
  } catch {
    useMemory = true;
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
};

const isMemoryMode = (): boolean => {
  if (useMemory) return true;
  try {
    const settings = getSettings();
    if (!settings.supabaseUrl || !settings.supabaseServiceRoleKey) {
      useMemory = true;
      return true;
    }
  } catch {
    useMemory = true;
    return true;
  }
  return false;
};

const nowIso = (): string => new Date().toISOString();

export const initScheduledFixturesRepo = (): void => {
  // Tables are managed via Supabase migrations.
};

export const upsertScheduledFixtures = async (fixtures: ScheduledFixtureInput[]): Promise<number> => {
  if (fixtures.length === 0) {
    return 0;
  }
  if (isMemoryMode()) {
    let stored = 0;
    const timestamp = nowIso();
    for (const fixture of fixtures) {
      const existing = memoryFixtures.get(fixture.fixture_id);
      memoryFixtures.set(fixture.fixture_id, {
        id: existing?.id ?? crypto.randomUUID(),
        ...fixture,
        status: "scheduled",
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
      });
      stored += 1;
    }
    return stored;
  }

  const supabase = getClient();
  const timestamp = nowIso();
  let stored = 0;

  for (const fixture of fixtures) {
    const { error } = await supabase.from("scheduled_fixtures").upsert(
      {
        ...fixture,
        updated_at: timestamp,
      },
      { onConflict: "fixture_id" },
    );

    if (error) {
      throw error;
    }
    stored += 1;
  }

  return stored;
};

export const getScheduledFixtures = async (): Promise<ScheduledFixture[]> => {
  if (isMemoryMode()) {
    return Array.from(memoryFixtures.values());
  }

  const supabase = getClient();
  const { data, error } = await supabase.from("scheduled_fixtures").select("*").order("kickoff_time");
  if (error) {
    throw error;
  }
  return (data ?? []) as ScheduledFixture[];
};

export const getScheduledFixture = async (fixtureId: number): Promise<ScheduledFixture | null> => {
  if (isMemoryMode()) {
    return memoryFixtures.get(fixtureId) ?? null;
  }

  const supabase = getClient();
  const { data, error } = await supabase.from("scheduled_fixtures").select("*").eq("fixture_id", fixtureId).maybeSingle();
  if (error) {
    throw error;
  }
  return (data as ScheduledFixture) ?? null;
};

export const getScheduledFixturesByStatus = async (status: string): Promise<ScheduledFixture[]> => {
  if (isMemoryMode()) {
    return Array.from(memoryFixtures.values()).filter((f) => f.status === status);
  }

  const supabase = getClient();
  const { data, error } = await supabase.from("scheduled_fixtures").select("*").eq("status", status).order("kickoff_time");
  if (error) {
    throw error;
  }
  return (data ?? []) as ScheduledFixture[];
};

export const deleteAllScheduledFixtures = async (): Promise<void> => {
  if (isMemoryMode()) {
    memoryFixtures.clear();
    return;
  }
  const supabase = getClient();
  await supabase.from("scheduled_fixtures").delete().neq("fixture_id", 0);
};

export const countScheduledFixtures = async (): Promise<number> => {
  if (isMemoryMode()) {
    return memoryFixtures.size;
  }
  const supabase = getClient();
  const { count, error } = await supabase.from("scheduled_fixtures").select("*", { count: "exact", head: true });
  if (error) {
    throw error;
  }
  return count ?? 0;
};