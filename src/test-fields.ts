/**
 * Diagnostic script: Dump raw API field names from SofaScore.
 * 
 * Purpose: Discover the exact field names in team statistics,
 * player statistics, and transfer history responses.
 *
 * Usage: npx ts-node src/test-fields.ts
 */

import { chromium, Page } from 'playwright';

// ── Helpers ──

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Recursively dump all keys from an object, up to `maxDepth` levels.
 * Prints the path, type, and a sample value for leaf nodes.
 */
function dumpKeys(obj: any, prefix: string = '', depth: number = 0, maxDepth: number = 2): void {
  if (obj === null || obj === undefined || depth > maxDepth) return;

  if (Array.isArray(obj)) {
    console.log(`${prefix} [Array, length=${obj.length}]`);
    if (obj.length > 0 && depth < maxDepth) {
      console.log(`${prefix}[0]:`);
      dumpKeys(obj[0], `${prefix}[0]`, depth + 1, maxDepth);
    }
    return;
  }

  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    for (const key of keys) {
      const val = obj[key];
      const valType = Array.isArray(val) ? 'array' : typeof val;
      const path = prefix ? `${prefix}.${key}` : key;

      if (valType === 'object' && val !== null && depth < maxDepth) {
        console.log(`${path}: {object}`);
        dumpKeys(val, path, depth + 1, maxDepth);
      } else if (valType === 'array') {
        console.log(`${path}: [array, length=${(val as any[]).length}]`);
        if ((val as any[]).length > 0 && depth < maxDepth) {
          dumpKeys(val[0], `${path}[0]`, depth + 1, maxDepth);
        }
      } else {
        // Leaf value: show type and sample
        const sample = typeof val === 'string' && val.length > 80 ? val.slice(0, 80) + '...' : val;
        console.log(`${path}: (${valType}) = ${sample}`);
      }
    }
  }
}

function captureApi(page: Page, pattern: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      page.removeListener('response', handler);
      reject(new Error(`Timeout waiting for: ${pattern}`));
    }, timeoutMs);

    const handler = async (response: any) => {
      const url: string = response.url();
      if (
        url.includes('www.sofascore.com/api/v1') &&
        url.includes(pattern) &&
        response.status() === 200
      ) {
        try {
          const json = await response.json();
          clearTimeout(timer);
          page.removeListener('response', handler);
          resolve(json);
        } catch {
          // JSON parse failed — skip this response, keep listening
        }
      }
    };
    page.on('response', handler);
  });
}

async function extractNextData(page: Page): Promise<any> {
  return page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__');
    return el ? JSON.parse(el.textContent || '{}') : null;
  });
}

async function tryClickTab(page: Page, tabName: string): Promise<boolean> {
  const selectors = [
    `text="${tabName}"`,
    `a:has-text("${tabName}")`,
    `button:has-text("${tabName}")`,
    `div[role="tab"]:has-text("${tabName}")`,
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) {
        await el.click();
        return true;
      }
    } catch {}
  }
  return false;
}

// ── Main ──

async function main() {
  console.log('Launching browser (headed)...\n');
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  // Block heavy resources to speed up
  await context.route(
    /\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot)(\?.*)?$/,
    (route) => route.abort()
  );

  const page = await context.newPage();

  // ═══════════════════════════════════════════════════════════
  // PART A: Team Statistics — Man Utd (team/35)
  // ═══════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('PART A: TEAM STATISTICS (Man Utd, team/35)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Capture the seasons endpoint during team page load
  const teamStatsSeasonsCapture = captureApi(page, 'team/35/team-statistics/seasons', 20000);
  const standingsSeasonsCapture = captureApi(page, 'team/35/standings/seasons', 20000);

  await page.goto('https://www.sofascore.com/football/team/manchester-united/35', {
    waitUntil: 'load',
    timeout: 30000,
  });
  await delay(3000);

  // Determine tournament & season IDs
  let tournamentId: number | undefined;
  let seasonId: number | undefined;

  const teamStatsSeasons = await teamStatsSeasonsCapture.catch(() => null);
  const standingsSeasons = await standingsSeasonsCapture.catch(() => null);

  const seasonsSource = teamStatsSeasons || standingsSeasons;
  if (seasonsSource?.uniqueTournamentSeasons?.[0]) {
    const uts = seasonsSource.uniqueTournamentSeasons[0];
    tournamentId = uts.uniqueTournament?.id;
    seasonId = uts.seasons?.[0]?.id;
    console.log(`Found: Tournament=${uts.uniqueTournament?.name} (${tournamentId}), Season=${uts.seasons?.[0]?.name} (${seasonId})\n`);
  }

  if (tournamentId && seasonId) {
    const statsPattern = `/team/35/unique-tournament/${tournamentId}/season/${seasonId}/statistics/overall`;
    console.log(`Waiting for API pattern: ${statsPattern}`);
    const statsCapture = captureApi(page, statsPattern, 20000);

    // Click Statistics tab
    const clicked = await tryClickTab(page, 'Statistics');
    console.log(`Clicked "Statistics" tab: ${clicked}`);
    await delay(5000);

    const statsData = await statsCapture.catch((e) => {
      console.log(`TIMEOUT: ${e.message}`);
      return null;
    });

    if (statsData) {
      console.log('\n--- RAW TEAM STATISTICS RESPONSE (top-level keys) ---');
      console.log('Top-level keys:', Object.keys(statsData));

      console.log('\n--- FULL KEY DUMP (2 levels deep) ---');
      dumpKeys(statsData, '', 0, 3);

      // Also dump a raw JSON snippet of the `statistics` key specifically
      if (statsData.statistics) {
        console.log('\n--- RAW statsData.statistics (JSON, first 3000 chars) ---');
        console.log(JSON.stringify(statsData.statistics, null, 2).slice(0, 3000));
      }
    } else {
      console.log('\nNo team statistics API response captured.');
      console.log('Trying to capture ANY API calls that happened...');
    }
  } else {
    console.log('Could not determine tournamentId/seasonId. Skipping team stats.');
  }

  await delay(2000);

  // ═══════════════════════════════════════════════════════════
  // PART B: Player Page — Amad Diallo (/971037)
  // ═══════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('PART B: PLAYER PAGE (Amad Diallo, /971037)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Set up captures before navigation
  const playerSeasonsCapture = captureApi(page, 'player/971037/statistics/seasons', 20000);
  const attrCapture = captureApi(page, 'player/971037/attribute-overviews', 20000);

  await page.goto('https://www.sofascore.com/football/player/diallo-amad/971037', {
    waitUntil: 'load',
    timeout: 30000,
  });
  await delay(5000);

  // ── B1: __NEXT_DATA__ — Transfer History Structure ──
  console.log('--- __NEXT_DATA__ TRANSFER HISTORY DUMP ---\n');
  const nextData = await extractNextData(page);
  const initialProps = nextData?.props?.pageProps?.initialProps;

  if (initialProps?.transfers) {
    const transfers = initialProps.transfers;
    console.log(`Transfer records found: ${transfers.length}\n`);

    // Dump full structure of first transfer
    if (transfers[0]) {
      console.log('--- Transfer[0] full key dump (3 levels) ---');
      dumpKeys(transfers[0], 'transfer[0]', 0, 3);
      console.log('\n--- Transfer[0] raw JSON ---');
      console.log(JSON.stringify(transfers[0], null, 2));
    }

    // Dump second transfer too if available
    if (transfers[1]) {
      console.log('\n--- Transfer[1] raw JSON ---');
      console.log(JSON.stringify(transfers[1], null, 2));
    }
  } else {
    console.log('No transfers found in __NEXT_DATA__.');
    // Dump what keys ARE available in initialProps
    if (initialProps) {
      console.log('\ninitialProps keys:', Object.keys(initialProps));
    }
    // Try checking the full pageProps structure
    if (nextData?.props?.pageProps) {
      console.log('pageProps keys:', Object.keys(nextData.props.pageProps));
      // Dump 2 levels of pageProps to find transfers
      console.log('\n--- pageProps key dump (2 levels) ---');
      dumpKeys(nextData.props.pageProps, 'pageProps', 0, 2);
    }
  }

  // ── B2: Player Seasons API ──
  console.log('\n--- PLAYER STATISTICS/SEASONS DUMP ---\n');
  const playerSeasons = await playerSeasonsCapture.catch((e) => {
    console.log(`TIMEOUT: ${e.message}`);
    return null;
  });

  let pTournamentId: number | undefined;
  let pSeasonId: number | undefined;

  if (playerSeasons) {
    console.log('Top-level keys:', Object.keys(playerSeasons));
    console.log('\n--- Full key dump (3 levels) ---');
    dumpKeys(playerSeasons, '', 0, 3);

    // Extract first tournament/season for next step
    if (playerSeasons.uniqueTournamentSeasons?.[0]) {
      const uts = playerSeasons.uniqueTournamentSeasons[0];
      pTournamentId = uts.uniqueTournament?.id;
      pSeasonId = uts.seasons?.[0]?.id;
      console.log(`\nWill query player stats for: tournament=${pTournamentId}, season=${pSeasonId}`);
    }
  } else {
    console.log('No player seasons data captured.');
  }

  // Dump attribute overviews too
  const attrData = await attrCapture.catch(() => null);
  if (attrData) {
    console.log('\n--- PLAYER ATTRIBUTE-OVERVIEWS DUMP ---');
    console.log('Top-level keys:', Object.keys(attrData));
    dumpKeys(attrData, '', 0, 3);
  }

  // ── B3: Player Season Statistics ──
  if (pTournamentId && pSeasonId) {
    console.log('\n--- PLAYER SEASON STATISTICS DUMP ---\n');

    const seasonStatsPattern = `player/971037/unique-tournament/${pTournamentId}/season/${pSeasonId}/statistics/overall`;
    console.log(`Waiting for: ${seasonStatsPattern}`);
    const seasonStatsCapture = captureApi(page, seasonStatsPattern, 20000);

    // Click Statistics tab
    const clicked = await tryClickTab(page, 'Statistics');
    console.log(`Clicked "Statistics" tab: ${clicked}`);
    await delay(5000);

    const seasonStats = await seasonStatsCapture.catch((e) => {
      console.log(`TIMEOUT: ${e.message}`);
      return null;
    });

    if (seasonStats) {
      console.log('\nTop-level keys:', Object.keys(seasonStats));
      console.log('\n--- Full key dump (3 levels) ---');
      dumpKeys(seasonStats, '', 0, 3);

      // Raw JSON of statistics sub-object
      if (seasonStats.statistics) {
        console.log('\n--- RAW seasonStats.statistics (JSON, first 5000 chars) ---');
        console.log(JSON.stringify(seasonStats.statistics, null, 2).slice(0, 5000));
      }
    } else {
      console.log('No player season statistics captured.');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // DONE
  // ═══════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('DIAGNOSTIC COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');

  await browser.close();
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
