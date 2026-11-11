-- Scheduled fixtures table for auto-scheduling
-- Stores both API Football fixtureId and Diretta matchId for live monitoring

CREATE TABLE IF NOT EXISTS public.scheduled_fixtures (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    fixture_id INTEGER NOT NULL,
    match_id TEXT NOT NULL,
    api_football_league_id INTEGER NOT NULL,
    api_football_league_name TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    kickoff_time TIMESTAMPTZ NOT NULL,
    begin_monitoring_time TIMESTAMPTZ NOT NULL,
    end_monitoring_time TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'scheduled',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(fixture_id)
);

-- Index for querying by date
CREATE INDEX IF NOT EXISTS idx_scheduled_fixtures_kickoff ON public.scheduled_fixtures (kickoff_time);

-- Index for querying by status
CREATE INDEX IF NOT EXISTS idx_scheduled_fixtures_status ON public.scheduled_fixtures (status);

-- Enable Row Level Security
ALTER TABLE public.scheduled_fixtures ENABLE ROW LEVEL SECURITY;

-- Policy: allow all operations for service role
CREATE POLICY "Allow service role full access" ON public.scheduled_fixtures
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Policy: allow read access for anon
CREATE POLICY "Allow anon read access" ON public.scheduled_fixtures
    FOR SELECT
    TO anon
    USING (true);