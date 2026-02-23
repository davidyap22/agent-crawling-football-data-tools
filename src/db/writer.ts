import { getSupabase } from './client';
import { logger } from '../utils/logger';

export async function upsertTeamStatistics(data: {
  team_id: number;
  team_name: string;
  tournament_id: number;
  tournament_name: string;
  season_id: number;
  season_name: string;
  goals_scored?: number;
  goals_conceded?: number;
  shots_total?: number;
  shots_on_target?: number;
  shots_off_target?: number;
  blocked_shots?: number;
  corner_kicks?: number;
  offsides?: number;
  total_passes?: number;
  accurate_passes_pct?: number;
  possession_pct?: number;
  tackles?: number;
  interceptions?: number;
  clearances?: number;
  yellow_cards?: number;
  red_cards?: number;
  fouls?: number;
  matches_played?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  raw_data: any;
}): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from('sofascore_team_statistics')
    .upsert(data, { onConflict: 'team_id,tournament_id,season_id' });

  if (error) {
    logger.error(`Failed to upsert team statistics for team ${data.team_id}: ${error.message}`);
    throw error;
  }
  logger.info(`Upserted team statistics: ${data.team_name} (${data.tournament_name})`);
}

export async function upsertTeamPlayer(data: {
  player_id: number;
  team_id: number;
  player_name: string;
  position?: string;
  shirt_number?: number;
  height?: number;
  preferred_foot?: string;
  country_name?: string;
  market_value?: number;
  market_value_currency?: string;
  date_of_birth_timestamp?: number;
  contract_until_timestamp?: number;
  is_injured?: boolean;
  raw_data: any;
}): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from('sofascore_team_players')
    .upsert(data, { onConflict: 'player_id,team_id' });

  if (error) {
    logger.error(`Failed to upsert team player ${data.player_id}: ${error.message}`);
    throw error;
  }
  logger.debug(`Upserted player: ${data.player_name} (#${data.shirt_number || '?'})`);
}

export async function upsertPlayerProfile(data: {
  player_id: number;
  player_name: string;
  primary_position?: string;
  positions?: string[];
  height?: number;
  preferred_foot?: string;
  country_name?: string;
  current_team_id?: number;
  current_team_name?: string;
  market_value?: number;
  market_value_currency?: string;
  attacking_rating?: number;
  creative_rating?: number;
  defensive_rating?: number;
  technical_rating?: number;
  tactical_rating?: number;
  strengths?: string[];
  weaknesses?: string[];
  national_team_stats?: any;
  transfer_history?: any;
  attributes_raw?: any;
  raw_profile?: any;
}): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from('sofascore_player_profiles')
    .upsert(data, { onConflict: 'player_id' });

  if (error) {
    logger.error(`Failed to upsert player profile ${data.player_id}: ${error.message}`);
    throw error;
  }
  logger.info(`Upserted player profile: ${data.player_name}`);
}

export async function upsertPlayerSeasonStats(data: {
  player_id: number;
  player_name: string;
  tournament_id: number;
  tournament_name: string;
  season_id: number;
  season_name: string;
  // Matches
  appearances?: number;
  matches_started?: number;
  minutes_played?: number;
  totw_appearances?: number;
  // Attacking
  goals?: number;
  expected_goals?: number;
  scoring_frequency?: number;
  total_shots?: number;
  shots_on_target?: number;
  shots_off_target?: number;
  big_chances_missed?: number;
  goal_conversion_pct?: number;
  free_kick_goals?: number;
  set_piece_conversion?: number;
  goals_from_inside_box?: number;
  goals_from_outside_box?: number;
  headed_goals?: number;
  left_foot_goals?: number;
  right_foot_goals?: number;
  penalty_goals?: number;
  penalty_won?: number;
  hit_woodwork?: number;
  // Passing
  assists?: number;
  expected_assists?: number;
  touches?: number;
  big_chances_created?: number;
  key_passes?: number;
  accurate_passes?: number;
  accurate_passes_pct?: number;
  total_passes?: number;
  accurate_own_half?: number;
  accurate_opposition_half?: number;
  accurate_long_balls?: number;
  accurate_long_balls_pct?: number;
  accurate_crosses?: number;
  accurate_crosses_pct?: number;
  accurate_chipped_passes?: number;
  // Defending
  interceptions?: number;
  tackles?: number;
  tackles_won_pct?: number;
  possession_won_att_third?: number;
  ball_recovery?: number;
  dribbled_past?: number;
  clearances?: number;
  blocked_shots?: number;
  error_lead_to_shot?: number;
  error_lead_to_goal?: number;
  penalty_committed?: number;
  // Other (per game in display, but totals in API)
  successful_dribbles?: number;
  successful_dribbles_pct?: number;
  total_duels_won?: number;
  total_duels_won_pct?: number;
  ground_duels_won?: number;
  ground_duels_won_pct?: number;
  aerial_duels_won?: number;
  aerial_duels_won_pct?: number;
  possession_lost?: number;
  fouls?: number;
  was_fouled?: number;
  offsides?: number;
  // Cards
  yellow_cards?: number;
  yellow_red_cards?: number;
  red_cards?: number;
  direct_red_cards?: number;
  // Rating
  rating?: number;
  raw_data: any;
}): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from('sofascore_player_season_stats')
    .upsert(data, { onConflict: 'player_id,tournament_id,season_id' });

  if (error) {
    logger.error(`Failed to upsert player season stats ${data.player_id}: ${error.message}`);
    throw error;
  }
  logger.debug(`Upserted season stats: ${data.player_name} (${data.tournament_name})`);
}
