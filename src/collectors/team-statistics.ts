import { Page } from 'playwright';
import { captureApiResponse, tryClickTab } from '../browser/interceptor';
import { upsertTeamStatistics } from '../db/writer';
import { delay } from '../utils/delay';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';
import { ENV } from '../config/env';

interface TeamInfo {
  teamId: number;
  slug: string;
  name: string;
}

interface SeasonInfo {
  seasonId: number;
  seasonName: string;
}

export async function collectTeamStatistics(
  page: Page,
  team: TeamInfo,
  tournamentId: number,
  tournamentName: string,
  season: SeasonInfo
): Promise<void> {
  const url = `https://www.sofascore.com/football/team/${team.slug}/${team.teamId}`;
  const statsApiPattern = `/team/${team.teamId}/unique-tournament/${tournamentId}/season/${season.seasonId}/statistics/overall`;

  logger.info(`Collecting team statistics: ${team.name} (${tournamentName})...`);

  await withRetry(async () => {
    // Navigate to team page
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(ENV.TAB_DELAY_MS);

    // Start listening BEFORE clicking tab
    const capturePromise = captureApiResponse(page, statsApiPattern, 15000);

    // Click Statistics tab
    const statsTabClicked = await tryClickTab(page, 'Statistics');
    if (!statsTabClicked) {
      throw new Error(`Could not find Statistics tab for ${team.name}`);
    }

    await delay(ENV.TAB_DELAY_MS);

    const statsData = await capturePromise;
    const s = statsData?.statistics;

    if (!s) {
      logger.warn(`No statistics data found for ${team.name}`);
      return;
    }

    await upsertTeamStatistics({
      team_id: team.teamId,
      team_name: team.name,
      tournament_id: tournamentId,
      tournament_name: tournamentName,
      season_id: season.seasonId,
      season_name: season.seasonName,
      // Actual SofaScore field names
      goals_scored: s.goalsScored,
      goals_conceded: s.goalsConceded,
      shots_total: s.shots,
      shots_on_target: s.shotsOnTarget,
      shots_off_target: s.shotsOffTarget,
      blocked_shots: s.blockedScoringAttempt,
      corner_kicks: s.corners,
      offsides: s.offsides,
      total_passes: s.totalPasses,
      accurate_passes_pct: s.accuratePassesPercentage,
      possession_pct: s.averageBallPossession,
      tackles: s.tackles,
      interceptions: s.interceptions,
      clearances: s.clearances,
      yellow_cards: s.yellowCards,
      red_cards: s.redCards,
      fouls: s.fouls,
      matches_played: s.matches,
      wins: s.wins,
      draws: s.draws,
      losses: s.losses,
      raw_data: statsData,
    });
  }, `Team stats: ${team.name}`, ENV.MAX_RETRIES, ENV.RETRY_DELAY_MS);
}
