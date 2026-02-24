-- OddsFlow Team Statistics (merged: team_statistics + SofaScore crawl)
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS oddsflow_team_statistics (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL,
  team_name TEXT NOT NULL,
  league_name TEXT,
  season INTEGER,
  supabase_original_data JSONB,    -- team_statistics 原始数据
  sofascore_data JSONB,            -- SofaScore crawl 完整数据
  data_collection_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (team_id, league_name)
);

-- Auto-update updated_at
CREATE TRIGGER trg_oddsflow_team_stats_updated
  BEFORE UPDATE ON oddsflow_team_statistics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_oddsflow_team_stats_league ON oddsflow_team_statistics (league_name);
CREATE INDEX IF NOT EXISTS idx_oddsflow_team_stats_date ON oddsflow_team_statistics (data_collection_date);
