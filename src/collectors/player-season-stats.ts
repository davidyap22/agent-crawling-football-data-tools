import { Page } from 'playwright';
import { upsertPlayerSeasonStats } from '../db/writer';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';
import { ENV } from '../config/env';
import { PlayerBasicInfo } from './team-players';

interface SeasonInfo {
  seasonId: number;
  seasonName: string;
}

export async function collectPlayerSeasonStats(
  page: Page,
  player: PlayerBasicInfo,
  tournamentId: number,
  tournamentName: string,
  season: SeasonInfo
): Promise<void> {
  const apiUrl = `https://www.sofascore.com/api/v1/player/${player.playerId}/unique-tournament/${tournamentId}/season/${season.seasonId}/statistics/overall`;

  logger.debug(`Collecting season stats: ${player.name} (${tournamentName})...`);

  await withRetry(async () => {
    const result = await page.evaluate(async (url) => {
      try {
        const res = await fetch(url);
        if (res.ok) return await res.json();
        return null;
      } catch {
        return null;
      }
    }, apiUrl);

    if (!result?.statistics) {
      logger.debug(`No season stats for ${player.name} in ${tournamentName}`);
      return;
    }

    const s = result.statistics;

    await upsertPlayerSeasonStats({
      player_id: player.playerId,
      player_name: player.name,
      tournament_id: tournamentId,
      tournament_name: tournamentName,
      season_id: season.seasonId,
      season_name: season.seasonName,

      // Matches
      appearances: s.appearances,
      matches_started: s.matchesStarted,
      minutes_played: s.minutesPlayed,
      totw_appearances: s.totwAppearances,

      // Attacking
      goals: s.goals,
      expected_goals: s.expectedGoals,
      scoring_frequency: s.scoringFrequency,
      total_shots: s.totalShots,
      shots_on_target: s.shotsOnTarget,
      shots_off_target: s.shotsOffTarget,
      big_chances_missed: s.bigChancesMissed,
      goal_conversion_pct: s.goalConversionPercentage,
      free_kick_goals: s.freeKickGoal,
      set_piece_conversion: s.setPieceConversion,
      goals_from_inside_box: s.goalsFromInsideTheBox,
      goals_from_outside_box: s.goalsFromOutsideTheBox,
      headed_goals: s.headedGoals,
      left_foot_goals: s.leftFootGoals,
      right_foot_goals: s.rightFootGoals,
      penalty_goals: s.penaltyGoals,
      penalty_won: s.penaltyWon,
      hit_woodwork: s.hitWoodwork,

      // Passing
      assists: s.assists,
      expected_assists: s.expectedAssists,
      touches: s.touches,
      big_chances_created: s.bigChancesCreated,
      key_passes: s.keyPasses,
      accurate_passes: s.accuratePasses,
      accurate_passes_pct: s.accuratePassesPercentage,
      total_passes: s.totalPasses,
      accurate_own_half: s.accurateOwnHalfPasses,
      accurate_opposition_half: s.accurateOppositionHalfPasses,
      accurate_long_balls: s.accurateLongBalls,
      accurate_long_balls_pct: s.accurateLongBallsPercentage,
      accurate_crosses: s.accurateCrosses,
      accurate_crosses_pct: s.accurateCrossesPercentage,
      accurate_chipped_passes: s.accurateChippedPasses,

      // Defending
      interceptions: s.interceptions,
      tackles: s.tackles,
      tackles_won_pct: s.tacklesWonPercentage,
      possession_won_att_third: s.possessionWonAttThird,
      ball_recovery: s.ballRecovery,
      dribbled_past: s.dribbledPast,
      clearances: s.clearances,
      blocked_shots: s.blockedShots,
      error_lead_to_shot: s.errorLeadToShot,
      error_lead_to_goal: s.errorLeadToGoal,
      penalty_committed: s.penaltyConceded,

      // Other
      successful_dribbles: s.successfulDribbles,
      successful_dribbles_pct: s.successfulDribblesPercentage,
      total_duels_won: s.totalDuelsWon,
      total_duels_won_pct: s.totalDuelsWonPercentage,
      ground_duels_won: s.groundDuelsWon,
      ground_duels_won_pct: s.groundDuelsWonPercentage,
      aerial_duels_won: s.aerialDuelsWon,
      aerial_duels_won_pct: s.aerialDuelsWonPercentage,
      possession_lost: s.possessionLost,
      fouls: s.fouls,
      was_fouled: s.wasFouled,
      offsides: s.offsides,

      // Cards
      yellow_cards: s.yellowCards,
      yellow_red_cards: s.yellowRedCards,
      red_cards: s.redCards,
      direct_red_cards: s.directRedCards,

      // Rating
      rating: s.rating,

      // Full API response
      raw_data: result,
    });
  }, `Player season stats: ${player.name}`, 1, ENV.RETRY_DELAY_MS);
}
