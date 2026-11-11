-- Teams table for direttait mapping to API-Football
-- Run this in Supabase SQL editor or via migration

CREATE TABLE IF NOT EXISTS public.teams (
    id TEXT PRIMARY KEY,
    diretta_name TEXT NOT NULL,
    api_football_id INTEGER,
    api_football_name TEXT,
    api_football_league_id INTEGER,
    api_football_league_name TEXT,
    diretta_league TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying by diretta_league
CREATE INDEX IF NOT EXISTS idx_teams_diretta_league ON public.teams (diretta_league);

-- Index for querying by api_football_league_id
CREATE INDEX IF NOT EXISTS idx_teams_api_football_league ON public.teams (api_football_league_id);

-- Index for querying by api_football_id
CREATE INDEX IF NOT EXISTS idx_teams_api_football_id ON public.teams (api_football_id);

-- Enable Row Level Security
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- Policy: allow all operations for service role
CREATE POLICY "Allow service role full access" ON public.teams
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Policy: allow read access for anon (if needed for public API)
CREATE POLICY "Allow anon read access" ON public.teams
    FOR SELECT
    TO anon
    USING (true);