import { Page } from 'playwright';
import { captureApiResponse, extractNextData, tryClickTab } from '../browser/interceptor';
import { upsertTeamPlayer } from '../db/writer';
import { delay } from '../utils/delay';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';
import { ENV } from '../config/env';

interface TeamInfo {
  teamId: number;
  slug: string;
  name: string;
}

export interface PlayerBasicInfo {
  playerId: number;
  slug: string;
  name: string;
}

export async function collectTeamPlayers(
  page: Page,
  team: TeamInfo
): Promise<PlayerBasicInfo[]> {
  const url = `https://www.sofascore.com/football/team/${team.slug}/${team.teamId}`;

  logger.info(`Collecting players for: ${team.name}...`);
  const players: PlayerBasicInfo[] = [];

  await withRetry(async () => {
    // Navigate to team page
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await delay(ENV.TAB_DELAY_MS);

    // Try clicking Players tab
    await tryClickTab(page, 'Players');
    await delay(3000);

    // Method 1: Extract player links from the page
    const playerLinks = await page.locator('a[href*="/player/"]').all();
    const seen = new Set<string>();

    for (const link of playerLinks) {
      try {
        const href = await link.getAttribute('href');
        if (!href || seen.has(href)) continue;
        seen.add(href);

        // Parse href: /football/player/{slug}/{playerId}
        const match = href.match(/\/football\/player\/([^/]+)\/(\d+)/);
        if (!match) continue;

        const playerSlug = match[1];
        const playerId = parseInt(match[2], 10);

        // Try to get text content for name
        const text = (await link.textContent()) || '';
        const playerName = text.trim() || playerSlug.replace(/-/g, ' ');

        await upsertTeamPlayer({
          player_id: playerId,
          team_id: team.teamId,
          player_name: playerName,
          raw_data: { href, source: 'page_links' },
        });

        players.push({
          playerId,
          slug: playerSlug,
          name: playerName,
        });
      } catch {
        // Skip failed links
      }
    }

    logger.info(`Found ${players.length} players for ${team.name}`);
  }, `Team players: ${team.name}`, ENV.MAX_RETRIES, ENV.RETRY_DELAY_MS);

  return players;
}
