-- OddsFlow Player Statistics (merged: player_stats + SofaScore crawl)
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS oddsflow_player_statistics (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  team_name TEXT NOT NULL,
  supabase_original_data JSONB,
  sofascore_data JSONB,
  data_collection_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (player_id)
);

-- Auto-update updated_at
CREATE TRIGGER trg_oddsflow_player_stats_updated
  BEFORE UPDATE ON oddsflow_player_statistics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_oddsflow_player_stats_team ON oddsflow_player_statistics (team_name);
CREATE INDEX IF NOT EXISTS idx_oddsflow_player_stats_date ON oddsflow_player_statistics (data_collection_date);
