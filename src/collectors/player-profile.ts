import { Page } from 'playwright';
import { captureMultipleApiResponses, extractNextData } from '../browser/interceptor';
import { upsertPlayerProfile } from '../db/writer';
import { delay } from '../utils/delay';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';
import { ENV } from '../config/env';
import { PlayerBasicInfo } from './team-players';

export async function collectPlayerProfile(
  page: Page,
  player: PlayerBasicInfo
): Promise<void> {
  const url = `https://www.sofascore.com/football/player/${player.slug}/${player.playerId}`;

  const attributesPattern = `player/${player.playerId}/attribute-overviews`;
  const characteristicsPattern = `player/${player.playerId}/characteristics`;
  const nationalTeamPattern = `player/${player.playerId}/national-team-statistics`;

  logger.info(`Collecting profile: ${player.name} (${player.playerId})...`);

  await withRetry(async () => {
    // Start listening for APIs, then navigate
    const capturePromise = captureMultipleApiResponses(
      page,
      [attributesPattern, characteristicsPattern, nationalTeamPattern],
      20000
    );

    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await delay(4000);

    // Extract profile + transfers from __NEXT_DATA__ (SSR)
    const nextData = await extractNextData(page);
    const initialProps = nextData?.props?.pageProps?.initialProps;

    const p = initialProps?.player || {};
    const transfers = initialProps?.transfers || [];

    // Capture API data
    const apiResults: Record<string, any> = await capturePromise.catch(() => ({}));
    const attrData = apiResults[attributesPattern];
    const charData = apiResults[characteristicsPattern];
    const ntData = apiResults[nationalTeamPattern];

    // Extract attribute ratings (current year = yearShift 0)
    let attackingRating: number | undefined;
    let creativeRating: number | undefined;
    let defensiveRating: number | undefined;
    let passingRating: number | undefined;
    let technicalRating: number | undefined;
    let tacticalRating: number | undefined;

    if (attrData?.playerAttributeOverviews) {
      const current = attrData.playerAttributeOverviews.find(
        (a: any) => a.yearShift === 0
      ) || attrData.playerAttributeOverviews[0];
      if (current) {
        attackingRating = current.attacking;
        creativeRating = current.creativity;
        defensiveRating = current.defending;
        technicalRating = current.technical;
        tacticalRating = current.tactical;
      }
    }

    // Extract strengths/weaknesses from DOM (type codes don't have text)
    const { strengths, weaknesses } = await extractStrengthsWeaknesses(page);

    // Extract positions from characteristics
    const positions = charData?.positions || [];

    // Extract national team stats
    let nationalTeamStats: any = null;
    if (ntData?.statistics?.[0]) {
      const nt = ntData.statistics[0];
      nationalTeamStats = {
        team: nt.team?.name,
        teamId: nt.team?.id,
        appearances: nt.appearances,
        goals: nt.goals,
        debutTimestamp: nt.debutTimestamp,
      };
    }

    // Format transfer history for storage
    const transferHistory = transfers.map((t: any) => ({
      fromTeam: t.transferFrom?.name || t.fromTeamName,
      fromTeamId: t.transferFrom?.id,
      toTeam: t.transferTo?.name || t.toTeamName,
      toTeamId: t.transferTo?.id,
      fee: t.transferFee,
      feeDescription: t.transferFeeDescription,
      feeCurrency: t.transferFeeRaw?.currency,
      type: t.type,
      dateTimestamp: t.transferDateTimestamp,
    }));

    await upsertPlayerProfile({
      player_id: player.playerId,
      player_name: p.name || player.name,
      primary_position: p.position,
      positions,
      height: p.height,
      preferred_foot: p.preferredFoot,
      country_name: p.country?.name,
      current_team_id: p.team?.id,
      current_team_name: p.team?.name,
      market_value: p.proposedMarketValue,
      market_value_currency: p.proposedMarketValueRaw?.currency,
      attacking_rating: attackingRating,
      creative_rating: creativeRating,
      defensive_rating: defensiveRating,
      technical_rating: technicalRating,
      tactical_rating: tacticalRating,
      strengths,
      weaknesses,
      national_team_stats: nationalTeamStats,
      transfer_history: transferHistory,
      attributes_raw: attrData,
      raw_profile: { player: p, characteristics: charData },
    });
  }, `Player profile: ${player.name}`, ENV.MAX_RETRIES, ENV.RETRY_DELAY_MS);
}

/**
 * Extract strengths/weaknesses text from the rendered page.
 * The characteristics API only returns type codes; the actual text is rendered by JS.
 */
async function extractStrengthsWeaknesses(page: Page): Promise<{
  strengths: string[];
  weaknesses: string[];
}> {
  try {
    return await page.evaluate(() => {
      const strengths: string[] = [];
      const weaknesses: string[] = [];

      const bodyText = document.body.innerText;
      const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);

      // Known position abbreviations to filter out
      const positionCodes = new Set([
        'GK', 'CB', 'LB', 'RB', 'LWB', 'RWB',
        'DM', 'MC', 'ML', 'MR', 'AM',
        'LW', 'RW', 'CF', 'ST', 'F', 'M', 'D',
      ]);

      let section: 'none' | 'strengths' | 'weaknesses' = 'none';

      for (const line of lines) {
        if (line === 'Strengths') {
          section = 'strengths';
          continue;
        }
        if (line === 'Weaknesses') {
          section = 'weaknesses';
          continue;
        }
        // Stop at known section boundaries
        if (section !== 'none' && (
          line === 'Player positions' || line === 'Player value' ||
          line === 'Attribute Overview' || line === 'Transfer history' ||
          line === 'National team' || line.startsWith('Search to compare') ||
          positionCodes.has(line)
        )) {
          section = 'none';
          continue;
        }

        // Must be a real trait (at least 4 chars, not a position code)
        const isValidTrait = line.length >= 4 &&
          !positionCodes.has(line) &&
          line !== 'No outstanding strengths' &&
          line !== 'No outstanding weaknesses';

        if (section === 'strengths' && isValidTrait) {
          strengths.push(line);
        }
        if (section === 'weaknesses' && isValidTrait) {
          weaknesses.push(line);
        }
      }

      return { strengths, weaknesses };
    });
  } catch {
    return { strengths: [], weaknesses: [] };
  }
}
