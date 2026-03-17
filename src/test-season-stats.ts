/**
 * Dump full player season statistics API response for Bruno Fernandes.
 */
import { chromium } from 'playwright';

const PLAYER_ID = 288205;
const SEASON_ID = 76986; // PL 25/26
const TOURNAMENT_ID = 17;

async function main() {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  // Need to visit sofascore first to establish session
  await page.goto('https://www.sofascore.com/football/player/bruno-fernandes/288205', {
    waitUntil: 'load', timeout: 30000,
  });
  await new Promise(r => setTimeout(r, 3000));

  // Fetch the season stats API
  const url = `https://www.sofascore.com/api/v1/player/${PLAYER_ID}/unique-tournament/${TOURNAMENT_ID}/season/${SEASON_ID}/statistics/overall`;
  const data = await page.evaluate(async (apiUrl) => {
    const res = await fetch(apiUrl);
    return res.ok ? await res.json() : { error: res.status };
  }, url);

  if (data?.statistics) {
    const s = data.statistics;
    console.log('=== Full Statistics JSON keys ===');
    const keys = Object.keys(s).sort();
    console.log(`Total keys: ${keys.length}\n`);

    // Group by category
    console.log('--- Matches ---');
    for (const k of keys.filter(k => ['appearances', 'started', 'minutesPerGame', 'minutesPlayed', 'teamOfTheWeek'].some(p => k.toLowerCase().includes(p.toLowerCase())) || k === 'type')) {
      console.log(`  ${k}: ${s[k]}`);
    }

    console.log('\n--- Attacking ---');
    for (const k of keys.filter(k => ['goal', 'shot', 'bigChance', 'conversion', 'scoring', 'penalty', 'freeKick', 'headed', 'leftFoot', 'rightFoot', 'insideBox', 'outsideBox'].some(p => k.toLowerCase().includes(p.toLowerCase())))) {
      console.log(`  ${k}: ${s[k]}`);
    }

    console.log('\n--- Passing ---');
    for (const k of keys.filter(k => ['assist', 'pass', 'touch', 'cross', 'longBall', 'keyPass', 'chip', 'ownHalf', 'oppositionHalf'].some(p => k.toLowerCase().includes(p.toLowerCase())))) {
      console.log(`  ${k}: ${s[k]}`);
    }

    console.log('\n--- Defending ---');
    for (const k of keys.filter(k => ['intercept', 'tackle', 'clearance', 'block', 'error', 'dribbledPast', 'recovery', 'possessionWon', 'penaltiesCommitted'].some(p => k.toLowerCase().includes(p.toLowerCase())))) {
      console.log(`  ${k}: ${s[k]}`);
    }

    console.log('\n--- Other ---');
    for (const k of keys.filter(k => ['dribble', 'duel', 'aerial', 'ground', 'possession', 'foul', 'offside', 'wasFouled'].some(p => k.toLowerCase().includes(p.toLowerCase())) && !k.includes('Won') || k.includes('duelsWon') || k.includes('dribbles'))) {
      console.log(`  ${k}: ${s[k]}`);
    }

    console.log('\n--- Cards ---');
    for (const k of keys.filter(k => ['card', 'yellow', 'red'].some(p => k.toLowerCase().includes(p.toLowerCase())))) {
      console.log(`  ${k}: ${s[k]}`);
    }

    console.log('\n--- Rating ---');
    for (const k of keys.filter(k => k.toLowerCase().includes('rating'))) {
      console.log(`  ${k}: ${s[k]}`);
    }

    // Print ALL keys for completeness
    console.log('\n\n=== ALL KEYS AND VALUES ===');
    for (const k of keys) {
      console.log(`  ${k}: ${JSON.stringify(s[k])}`);
    }
  } else {
    console.log('Error:', JSON.stringify(data));
  }

  await browser.close();
}

main().catch(console.error);
