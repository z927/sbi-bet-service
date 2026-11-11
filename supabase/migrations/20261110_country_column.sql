-- Add country column to teams table
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS country TEXT;

-- Drop legacy diretta_league column (replaced by country)
ALTER TABLE public.teams DROP COLUMN IF EXISTS diretta_league;

CREATE INDEX IF NOT EXISTS idx_teams_country ON public.teams (country);
