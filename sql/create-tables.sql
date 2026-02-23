-- SofaScore Data Tables
-- Run this in Supabase SQL Editor

-- 1. Team Statistics
CREATE TABLE IF NOT EXISTS sofascore_team_statistics (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL,
  team_name TEXT NOT NULL,
  tournament_id INTEGER NOT NULL,
  tournament_name TEXT,
  season_id INTEGER NOT NULL,
  season_name TEXT,
  goals_scored INTEGER,
  goals_conceded INTEGER,
  shots_total INTEGER,
  shots_on_target INTEGER,
  shots_off_target INTEGER,
  blocked_shots INTEGER,
  corner_kicks INTEGER,
  offsides INTEGER,
  total_passes INTEGER,
  accurate_passes_pct REAL,
  possession_pct REAL,
  tackles INTEGER,
  interceptions INTEGER,
  clearances INTEGER,
  yellow_cards INTEGER,
  red_cards INTEGER,
  fouls INTEGER,
  matches_played INTEGER,
  wins INTEGER,
  draws INTEGER,
  losses INTEGER,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (team_id, tournament_id, season_id)
);

-- 2. Team Players
CREATE TABLE IF NOT EXISTS sofascore_team_players (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  position TEXT,
  shirt_number INTEGER,
  height INTEGER,
  preferred_foot TEXT,
  country_name TEXT,
  market_value INTEGER,
  market_value_currency TEXT,
  date_of_birth_timestamp BIGINT,
  contract_until_timestamp BIGINT,
  is_injured BOOLEAN DEFAULT FALSE,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (player_id, team_id)
);

-- 3. Player Profiles
CREATE TABLE IF NOT EXISTS sofascore_player_profiles (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL UNIQUE,
  player_name TEXT NOT NULL,
  primary_position TEXT,
  positions JSONB,
  height INTEGER,
  preferred_foot TEXT,
  country_name TEXT,
  current_team_id INTEGER,
  current_team_name TEXT,
  market_value INTEGER,
  market_value_currency TEXT,
  attacking_rating REAL,
  creative_rating REAL,
  defensive_rating REAL,
  technical_rating REAL,
  tactical_rating REAL,
  strengths JSONB,
  weaknesses JSONB,
  national_team_stats JSONB,
  transfer_history JSONB,
  attributes_raw JSONB,
  raw_profile JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Player Season Stats (112 fields in API, key ones as columns + raw_data JSONB for all)
CREATE TABLE IF NOT EXISTS sofascore_player_season_stats (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  tournament_id INTEGER NOT NULL,
  tournament_name TEXT,
  season_id INTEGER NOT NULL,
  season_name TEXT,

  -- Matches
  appearances INTEGER,
  matches_started INTEGER,
  minutes_played INTEGER,
  totw_appearances INTEGER,

  -- Attacking
  goals INTEGER,
  expected_goals REAL,
  scoring_frequency REAL,
  total_shots INTEGER,
  shots_on_target INTEGER,
  shots_off_target INTEGER,
  big_chances_missed INTEGER,
  goal_conversion_pct REAL,
  free_kick_goals INTEGER,
  set_piece_conversion REAL,
  goals_from_inside_box INTEGER,
  goals_from_outside_box INTEGER,
  headed_goals INTEGER,
  left_foot_goals INTEGER,
  right_foot_goals INTEGER,
  penalty_goals INTEGER,
  penalty_won INTEGER,
  hit_woodwork INTEGER,

  -- Passing
  assists INTEGER,
  expected_assists REAL,
  touches INTEGER,
  big_chances_created INTEGER,
  key_passes INTEGER,
  accurate_passes INTEGER,
  accurate_passes_pct REAL,
  total_passes INTEGER,
  accurate_own_half INTEGER,
  accurate_opposition_half INTEGER,
  accurate_long_balls INTEGER,
  accurate_long_balls_pct REAL,
  accurate_crosses INTEGER,
  accurate_crosses_pct REAL,
  accurate_chipped_passes INTEGER,

  -- Defending
  interceptions INTEGER,
  tackles INTEGER,
  tackles_won_pct REAL,
  possession_won_att_third INTEGER,
  ball_recovery INTEGER,
  dribbled_past INTEGER,
  clearances INTEGER,
  blocked_shots INTEGER,
  error_lead_to_shot INTEGER,
  error_lead_to_goal INTEGER,
  penalty_committed INTEGER,

  -- Other
  successful_dribbles INTEGER,
  successful_dribbles_pct REAL,
  total_duels_won INTEGER,
  total_duels_won_pct REAL,
  ground_duels_won INTEGER,
  ground_duels_won_pct REAL,
  aerial_duels_won INTEGER,
  aerial_duels_won_pct REAL,
  possession_lost INTEGER,
  fouls INTEGER,
  was_fouled INTEGER,
  offsides INTEGER,

  -- Cards
  yellow_cards INTEGER,
  yellow_red_cards INTEGER,
  red_cards INTEGER,
  direct_red_cards INTEGER,

  -- Rating
  rating REAL,

  -- Full API response (all 112 fields)
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (player_id, tournament_id, season_id)
);

-- Auto-update updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_team_statistics_updated
  BEFORE UPDATE ON sofascore_team_statistics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_team_players_updated
  BEFORE UPDATE ON sofascore_team_players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_player_profiles_updated
  BEFORE UPDATE ON sofascore_player_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_player_season_stats_updated
  BEFORE UPDATE ON sofascore_player_season_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_team_stats_team ON sofascore_team_statistics (team_id);
CREATE INDEX IF NOT EXISTS idx_team_stats_tournament ON sofascore_team_statistics (tournament_id);
CREATE INDEX IF NOT EXISTS idx_team_players_team ON sofascore_team_players (team_id);
CREATE INDEX IF NOT EXISTS idx_team_players_player ON sofascore_team_players (player_id);
CREATE INDEX IF NOT EXISTS idx_player_profiles_team ON sofascore_player_profiles (current_team_id);
CREATE INDEX IF NOT EXISTS idx_player_season_stats_player ON sofascore_player_season_stats (player_id);
CREATE INDEX IF NOT EXISTS idx_player_season_stats_tournament ON sofascore_player_season_stats (tournament_id);
