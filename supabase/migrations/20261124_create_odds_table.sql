-- Tabella dedicata alle quote full-time (over 1.5 / over 2.5) recuperate da API-Football.
-- Una riga per fixture; aggiornata ad ogni recupero live.
CREATE TABLE IF NOT EXISTS public.odds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fixture_id INTEGER NOT NULL,
    match_id TEXT,
    over_15_odd REAL,
    over_25_odd REAL,
    source TEXT DEFAULT 'api-football',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT odds_fixture_id_unique UNIQUE (fixture_id)
);

CREATE INDEX IF NOT EXISTS idx_odds_fixture_id ON public.odds (fixture_id);
CREATE INDEX IF NOT EXISTS idx_odds_match_id ON public.odds (match_id);

ALTER TABLE public.odds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access" ON public.odds
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow anon read access" ON public.odds
    FOR SELECT
    TO anon
    USING (true);
