/**
 * Test: End-to-end crawl of Man Utd → one player.
 * No Supabase needed. Prints all captured data to console.
 *
 * Usage: npx ts-node src/test-crawl.ts
 */

import { chromium, Page } from 'playwright';

async function main() {
  console.log('Launching browser (headed)...\n');
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  await context.route(
    /\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot)(\?.*)?$/,
    (route) => route.abort()
  );

  const page = await context.newPage();

  // ═══ Step 1: Man Utd team page → season + standings ═══
  // (Team page auto-loads standings widget with all teams)
  console.log('=== Step 1: Man Utd page → season + teams ===');
  const standingsCapture = captureApi(page, 'standings/total', 20000);
  const seasonsCapture = captureApi(page, 'standings/seasons', 20000).catch(() => null);

  await page.goto(
    'https://www.sofascore.com/football/team/manchester-united/35',
    { waitUntil: 'load', timeout: 30000 }
  );
  await delay(5000);

  const [standingsData, seasonsData] = await Promise.all([
    standingsCapture.catch(() => null),
    seasonsCapture,
  ]);

  let seasonId: number | undefined;
  let seasonName: string | undefined;
  if (seasonsData?.uniqueTournamentSeasons?.[0]) {
    const s = seasonsData.uniqueTournamentSeasons[0].seasons?.[0];
    seasonId = s?.id;
    seasonName = s?.name || `${s?.year}`;
    console.log(`  Season: ${seasonName} (ID: ${seasonId})`);
  }

  const teams: Array<{ id: number; slug: string; name: string }> = [];
  if (standingsData?.standings?.[0]?.rows) {
    for (const row of standingsData.standings[0].rows) {
      teams.push({ id: row.team.id, slug: row.team.slug, name: row.team.name });
    }
  }
  console.log(`  Teams: ${teams.length} found`);

  await delay(2000);

  // ═══ Step 2: Man Utd → team statistics (already on team page) ═══
  console.log('\n=== Step 2: Man Utd team statistics ===');
  const statsPattern = `/team/35/unique-tournament/17/season/${seasonId}/statistics/overall`;
  const statsCapture = captureApi(page, statsPattern, 15000);
  await tryClickTab(page, 'Statistics');
  await delay(2000);

  const statsData = await statsCapture.catch(() => null);
  if (statsData?.statistics) {
    const s = statsData.statistics;
    console.log(`  Matches: ${s.matches}`);
    console.log(`  Goals: ${s.goalsScored} scored, ${s.goalsConceded} conceded`);
    console.log(`  Shots: ${s.shots} total, ${s.shotsOnTarget} on target`);
    console.log(`  Possession: ${s.averageBallPossession?.toFixed(1)}%`);
    console.log(`  Passes: ${s.totalPasses}, ${s.accuratePassesPercentage?.toFixed(1)}% accurate`);
    console.log(`  Cards: ${s.yellowCards}Y ${s.redCards}R`);
  } else {
    console.log('  No stats captured');
  }

  await delay(2000);

  // ═══ Step 3: Man Utd → player list (from page links) ═══
  console.log('\n=== Step 3: Man Utd players (from page links) ===');
  await page.goto(
    'https://www.sofascore.com/football/team/manchester-united/35',
    { waitUntil: 'load', timeout: 30000 }
  );
  await delay(2000);
  await tryClickTab(page, 'Players');
  await delay(3000);

  const playerLinks = await page.locator('a[href*="/player/"]').all();
  const playerSet = new Map<number, { slug: string; name: string }>();

  for (const link of playerLinks) {
    const href = await link.getAttribute('href');
    if (!href) continue;
    const match = href.match(/\/football\/player\/([^/]+)\/(\d+)/);
    if (!match) continue;
    const pid = parseInt(match[2], 10);
    if (playerSet.has(pid)) continue;
    const text = ((await link.textContent()) || '').trim();
    playerSet.set(pid, { slug: match[1], name: text || match[1] });
  }

  console.log(`  Players found: ${playerSet.size}`);
  const playerEntries = Array.from(playerSet.entries());
  for (const [pid, info] of playerEntries.slice(0, 5)) {
    console.log(`    ${info.name} (ID: ${pid}, slug: ${info.slug})`);
  }
  if (playerEntries.length > 5) console.log(`    ... +${playerEntries.length - 5} more`);

  // Pick first player
  const [firstPlayerId, firstPlayerInfo] = playerEntries[0];
  const playerUrl = `https://www.sofascore.com/football/player/${firstPlayerInfo.slug}/${firstPlayerId}`;

  await delay(2000);

  // ═══ Step 4+5: Player profile + season stats (single navigation) ═══
  console.log(`\n=== Step 4: Player profile + stats — ${firstPlayerInfo.name} ===`);

  // Capture ALL player APIs during navigation
  const attrCapture = captureApi(page, `player/${firstPlayerId}/attribute-overviews`, 20000);
  const charCapture = captureApi(page, `player/${firstPlayerId}/characteristics`, 20000);
  // Also capture statistics APIs (ignore timeout)
  const playerStatsCapture = captureApi(page, `player/${firstPlayerId}/statistics/seasons`, 20000).catch(() => null);

  await page.goto(playerUrl, { waitUntil: 'load', timeout: 30000 });
  await delay(5000);

  // SSR data from __NEXT_DATA__
  const nextData = await extractNextData(page);
  const ip = nextData?.props?.pageProps?.initialProps;

  if (ip?.player) {
    const p = ip.player;
    console.log(`  Name: ${p.name}`);
    console.log(`  Position: ${p.position} | Height: ${p.height}cm | Foot: ${p.preferredFoot}`);
    console.log(`  Country: ${p.country?.name} | Team: ${p.team?.name}`);
    console.log(`  Shirt: #${p.shirtNumber} | Value: €${(p.proposedMarketValue / 1e6).toFixed(1)}M`);
    console.log(`  DOB: ${new Date(p.dateOfBirthTimestamp * 1000).toISOString().slice(0, 10)}`);
  }

  if (ip?.transfers?.length) {
    console.log(`  Transfers: ${ip.transfers.length} records`);
    for (const t of ip.transfers.slice(0, 3)) {
      console.log(`    ${t.transferFrom?.name || t.fromTeamName} → ${t.transferTo?.name || t.toTeamName} (${t.transferFeeDescription || t.transferFee})`);
    }
  }

  const attrData = await attrCapture.catch(() => null);
  if (attrData?.playerAttributeOverviews?.[0]) {
    const a = attrData.playerAttributeOverviews[0];
    console.log(`  Attributes: ATK=${a.attacking} TEC=${a.technical} TAC=${a.tactical} DEF=${a.defending} CRE=${a.creativity}`);
  }

  const charData = await charCapture.catch(() => null);
  if (charData?.positions) {
    console.log(`  Positions: ${charData.positions.join(', ')}`);
  }

  // ═══ Step 5: Player season stats (via in-browser fetch) ═══
  console.log(`\n=== Step 5: Player season stats — ${firstPlayerInfo.name} ===`);

  // Use in-browser fetch to directly call the API (bypasses caching issues)
  const seasonStatsUrl = `https://www.sofascore.com/api/v1/player/${firstPlayerId}/unique-tournament/17/season/${seasonId}/statistics/overall`;

  const seasonStats = await page.evaluate(async (url) => {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      return { error: `HTTP ${res.status}` };
    } catch (e: any) {
      return { error: e.message };
    }
  }, seasonStatsUrl);

  if (seasonStats?.error) {
    console.log(`  API error: ${seasonStats.error}`);
  } else if (seasonStats?.statistics) {
    const s = seasonStats.statistics;
    console.log(`  Appearances: ${s.appearances} | Minutes: ${s.minutesPlayed}`);
    console.log(`  Goals: ${s.goals} (xG: ${s.expectedGoals}) | Assists: ${s.assists}`);
    console.log(`  Rating: ${s.rating}`);
    console.log(`  Shots: ${s.totalShots} total, ${s.shotsOnTarget} on target`);
    console.log(`  Passes: ${s.totalPasses} | Key passes: ${s.keyPasses}`);
    console.log(`  Tackles: ${s.tackles} | Interceptions: ${s.interceptions}`);
    console.log(`  Cards: ${s.yellowCards}Y ${s.redCards}R`);
  } else {
    console.log(`  Unexpected response: ${JSON.stringify(seasonStats).slice(0, 300)}`);
  }

  console.log('\n=== COMPLETE ===');
  await browser.close();
}

// ── Helpers ──

function captureApi(page: Page, pattern: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      page.removeListener('response', handler);
      reject(new Error(`Timeout: ${pattern}`));
    }, timeoutMs);

    const handler = async (response: any) => {
      const url = response.url();
      if (url.includes('www.sofascore.com/api/v1') && url.includes(pattern) && response.status() === 200) {
        try {
          const json = await response.json();
          clearTimeout(timer);
          page.removeListener('response', handler);
          resolve(json);
        } catch {
          // Skip, keep listening
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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function tryClickTab(page: Page, tabName: string): Promise<boolean> {
  for (const sel of [
    `text="${tabName}"`,
    `a:has-text("${tabName}")`,
    `button:has-text("${tabName}")`,
    `div[role="tab"]:has-text("${tabName}")`,
  ]) {
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

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
