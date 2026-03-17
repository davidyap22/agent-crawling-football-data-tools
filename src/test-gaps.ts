/**
 * Test: Verify all player data fields with Bruno Fernandes.
 */

import { chromium, Page } from 'playwright';
import { captureMultipleApiResponses, extractNextData } from './browser/interceptor';

const PLAYER_ID = 288205;
const PLAYER_SLUG = 'bruno-fernandes';

async function main() {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1440, height: 900 },
  });
  await context.route(/\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot)(\?.*)?$/, (r) => r.abort());

  const page = await context.newPage();
  const url = `https://www.sofascore.com/football/player/${PLAYER_SLUG}/${PLAYER_ID}`;

  // Capture APIs
  const capturePromise = captureMultipleApiResponses(
    page,
    [
      `player/${PLAYER_ID}/attribute-overviews`,
      `player/${PLAYER_ID}/characteristics`,
      `player/${PLAYER_ID}/national-team-statistics`,
    ],
    20000
  );

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 5000));

  // SSR
  const nextData = await extractNextData(page);
  const ip = nextData?.props?.pageProps?.initialProps;
  const p = ip?.player || {};

  // APIs
  const api: Record<string, any> = await capturePromise.catch(() => ({}));
  const attrData = api[`player/${PLAYER_ID}/attribute-overviews`];
  const charData = api[`player/${PLAYER_ID}/characteristics`];
  const ntData = api[`player/${PLAYER_ID}/national-team-statistics`];

  // Strengths/Weaknesses from DOM
  const { strengths, weaknesses } = await extractStrengthsWeaknesses(page);

  // Print everything
  console.log('====== BRUNO FERNANDES - FULL DATA ======\n');

  console.log('--- Profile (SSR) ---');
  console.log(`  Name: ${p.name}`);
  console.log(`  Position: ${p.position}`);
  console.log(`  Height: ${p.height}cm | Foot: ${p.preferredFoot}`);
  console.log(`  Country: ${p.country?.name}`);
  console.log(`  Team: ${p.team?.name} (ID: ${p.team?.id})`);
  console.log(`  Shirt: #${p.shirtNumber}`);
  console.log(`  DOB: ${new Date(p.dateOfBirthTimestamp * 1000).toISOString().slice(0, 10)}`);

  console.log('\n--- Market Value ---');
  console.log(`  Value: ${p.proposedMarketValue} (${p.proposedMarketValueRaw?.currency})`);
  console.log(`  Display: ${(p.proposedMarketValue / 1e6).toFixed(0)}M €`);

  console.log('\n--- Positions ---');
  console.log(`  Positions: ${charData?.positions?.join(', ') || 'N/A'}`);

  console.log('\n--- Strengths & Weaknesses (from DOM) ---');
  console.log(`  Strengths: ${strengths.length > 0 ? strengths.join(', ') : 'None'}`);
  console.log(`  Weaknesses: ${weaknesses.length > 0 ? weaknesses.join(', ') : 'No outstanding weaknesses'}`);

  console.log('\n--- Attribute Overview ---');
  if (attrData?.playerAttributeOverviews?.[0]) {
    const a = attrData.playerAttributeOverviews[0];
    console.log(`  ATT: ${a.attacking}`);
    console.log(`  TEC: ${a.technical}`);
    console.log(`  TAC: ${a.tactical}`);
    console.log(`  DEF: ${a.defending}`);
    console.log(`  CRE: ${a.creativity}`);
  }

  console.log('\n--- National Team ---');
  if (ntData?.statistics?.[0]) {
    const nt = ntData.statistics[0];
    console.log(`  Team: ${nt.team?.name}`);
    console.log(`  Appearances: ${nt.appearances}`);
    console.log(`  Goals: ${nt.goals}`);
    console.log(`  Debut: ${new Date(nt.debutTimestamp * 1000).toISOString().slice(0, 10)}`);
  }

  console.log('\n--- Transfer History ---');
  for (const t of (ip?.transfers || []).slice(0, 8)) {
    const from = t.transferFrom?.name || t.fromTeamName;
    const to = t.transferTo?.name || t.toTeamName;
    const fee = t.transferFeeDescription || '-';
    const date = new Date(t.transferDateTimestamp * 1000).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
    console.log(`  ${to} ← ${from} | ${fee} | ${date}`);
  }

  console.log('\n====== ALL DATA CAPTURED ======');
  await browser.close();
}

async function extractStrengthsWeaknesses(page: Page) {
  try {
    return await page.evaluate(() => {
      const strengths: string[] = [];
      const weaknesses: string[] = [];
      const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(Boolean);
      const positionCodes = new Set([
        'GK','CB','LB','RB','LWB','RWB','DM','MC','ML','MR','AM','LW','RW','CF','ST','F','M','D',
      ]);
      let section: 'none' | 's' | 'w' = 'none';

      for (const line of lines) {
        if (line === 'Strengths') { section = 's'; continue; }
        if (line === 'Weaknesses') { section = 'w'; continue; }
        if (section !== 'none' && (
          line === 'Player positions' || line === 'Player value' ||
          line === 'Attribute Overview' || line === 'Transfer history' ||
          line === 'National team' || line.startsWith('Search to compare') ||
          positionCodes.has(line)
        )) { section = 'none'; continue; }

        const valid = line.length >= 4 && !positionCodes.has(line) &&
          line !== 'No outstanding strengths' && line !== 'No outstanding weaknesses';
        if (section === 's' && valid) strengths.push(line);
        if (section === 'w' && valid) weaknesses.push(line);
      }
      return { strengths, weaknesses };
    });
  } catch { return { strengths: [], weaknesses: [] }; }
}

main().catch(console.error);
