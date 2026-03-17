/**
 * Demo: Full crawl of Bruno Fernandes - output complete JSON.
 */
import { chromium, Page } from 'playwright';

const PLAYER_ID = 288205;
const PLAYER_SLUG = 'bruno-fernandes';
const TOURNAMENT_ID = 17;
const SEASON_ID = 76986;

async function main() {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1440, height: 900 },
  });
  await context.route(/\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot)(\?.*)?$/, (r) => r.abort());

  const page = await context.newPage();
  const url = `https://www.sofascore.com/football/player/${PLAYER_SLUG}/${PLAYER_ID}`;

  // Capture APIs during navigation
  const attrCapture = captureApi(page, `player/${PLAYER_ID}/attribute-overviews`, 20000);
  const charCapture = captureApi(page, `player/${PLAYER_ID}/characteristics`, 20000);
  const ntCapture = captureApi(page, `player/${PLAYER_ID}/national-team-statistics`, 20000);

  console.error('Navigating to player page...');
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await delay(5000);

  // === SSR data ===
  const nextData = await page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__');
    return el ? JSON.parse(el.textContent || '{}') : null;
  });
  const ip = nextData?.props?.pageProps?.initialProps;
  const p = ip?.player || {};

  // === API data ===
  const [attrData, charData, ntData] = await Promise.all([
    attrCapture.catch(() => null),
    charCapture.catch(() => null),
    ntCapture.catch(() => null),
  ]);

  // === Strengths/Weaknesses from DOM ===
  const { strengths, weaknesses } = await page.evaluate(() => {
    const s: string[] = [];
    const w: string[] = [];
    const posCodes = new Set(['GK','CB','LB','RB','LWB','RWB','DM','MC','ML','MR','AM','LW','RW','CF','ST','F','M','D']);
    const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(Boolean);
    let sec: 'none'|'s'|'w' = 'none';
    for (const line of lines) {
      if (line === 'Strengths') { sec = 's'; continue; }
      if (line === 'Weaknesses') { sec = 'w'; continue; }
      if (sec !== 'none' && (posCodes.has(line) || ['Player positions','Player value','Attribute Overview','Transfer history','National team'].includes(line) || line.startsWith('Search to compare'))) { sec = 'none'; continue; }
      const ok = line.length >= 4 && !posCodes.has(line) && !line.startsWith('No outstanding');
      if (sec === 's' && ok) s.push(line);
      if (sec === 'w' && ok) w.push(line);
    }
    return { strengths: s, weaknesses: w };
  });

  // === Season stats via fetch ===
  console.error('Fetching season stats...');
  const seasonStats = await page.evaluate(async (apiUrl) => {
    const res = await fetch(apiUrl);
    return res.ok ? await res.json() : null;
  }, `https://www.sofascore.com/api/v1/player/${PLAYER_ID}/unique-tournament/${TOURNAMENT_ID}/season/${SEASON_ID}/statistics/overall`);

  const ss = seasonStats?.statistics || {};

  // === Build final JSON ===
  const attrs = attrData?.playerAttributeOverviews?.find((a: any) => a.yearShift === 0) || attrData?.playerAttributeOverviews?.[0];

  const result = {
    player_id: p.id,
    player_name: p.name,
    slug: p.slug,
    primary_position: p.position,
    positions: charData?.positions || [],
    height: p.height,
    preferred_foot: p.preferredFoot,
    country: p.country?.name,
    date_of_birth: p.dateOfBirthTimestamp ? new Date(p.dateOfBirthTimestamp * 1000).toISOString().slice(0, 10) : null,
    shirt_number: p.shirtNumber,
    current_team: {
      id: p.team?.id,
      name: p.team?.name,
    },
    market_value: {
      value: p.proposedMarketValue,
      currency: p.proposedMarketValueRaw?.currency,
    },
    strengths,
    weaknesses: weaknesses.length > 0 ? weaknesses : null,
    attribute_overview: attrs ? {
      attacking: attrs.attacking,
      technical: attrs.technical,
      tactical: attrs.tactical,
      defending: attrs.defending,
      creativity: attrs.creativity,
    } : null,
    national_team: ntData?.statistics?.[0] ? {
      team: ntData.statistics[0].team?.name,
      appearances: ntData.statistics[0].appearances,
      goals: ntData.statistics[0].goals,
      debut: ntData.statistics[0].debutTimestamp
        ? new Date(ntData.statistics[0].debutTimestamp * 1000).toISOString().slice(0, 10)
        : null,
    } : null,
    transfer_history: (ip?.transfers || []).map((t: any) => ({
      from_team: t.transferFrom?.name || t.fromTeamName,
      to_team: t.transferTo?.name || t.toTeamName,
      fee: t.transferFee,
      fee_display: t.transferFeeDescription,
      fee_currency: t.transferFeeRaw?.currency,
      date: t.transferDateTimestamp
        ? new Date(t.transferDateTimestamp * 1000).toISOString().slice(0, 10)
        : null,
      type: t.type,
    })),
    season_statistics: {
      tournament: 'Premier League',
      tournament_id: TOURNAMENT_ID,
      season: 'Premier League 25/26',
      season_id: SEASON_ID,

      matches: {
        appearances: ss.appearances,
        matches_started: ss.matchesStarted,
        minutes_per_game: ss.minutesPlayed && ss.appearances
          ? Math.round(ss.minutesPlayed / ss.appearances)
          : null,
        total_minutes_played: ss.minutesPlayed,
        team_of_the_week: ss.totwAppearances,
      },

      attacking: {
        goals: ss.goals,
        expected_goals: ss.expectedGoals,
        scoring_frequency_min: ss.scoringFrequency,
        goals_per_game: ss.appearances ? +(ss.goals / ss.appearances).toFixed(1) : null,
        total_shots: ss.totalShots,
        shots_on_target: ss.shotsOnTarget,
        shots_off_target: ss.shotsOffTarget,
        big_chances_missed: ss.bigChancesMissed,
        goal_conversion_pct: ss.goalConversionPercentage,
        free_kick_goals: ss.freeKickGoal,
        free_kick_shots: ss.shotFromSetPiece,
        free_kick_conversion_pct: ss.setPieceConversion,
        goals_from_inside_box: ss.goalsFromInsideTheBox,
        shots_from_inside_box: ss.shotsFromInsideTheBox,
        goals_from_outside_box: ss.goalsFromOutsideTheBox,
        shots_from_outside_box: ss.shotsFromOutsideTheBox,
        headed_goals: ss.headedGoals,
        left_foot_goals: ss.leftFootGoals,
        right_foot_goals: ss.rightFootGoals,
        penalty_goals: ss.penaltyGoals,
        penalties_taken: ss.penaltiesTaken,
        penalty_won: ss.penaltyWon,
        hit_woodwork: ss.hitWoodwork,
      },

      passing: {
        assists: ss.assists,
        expected_assists: ss.expectedAssists,
        touches: ss.touches,
        big_chances_created: ss.bigChancesCreated,
        key_passes: ss.keyPasses,
        key_passes_per_game: ss.appearances ? +(ss.keyPasses / ss.appearances).toFixed(1) : null,
        accurate_passes: ss.accuratePasses,
        accurate_passes_pct: ss.accuratePassesPercentage,
        total_passes: ss.totalPasses,
        accurate_own_half: ss.accurateOwnHalfPasses,
        total_own_half: ss.totalOwnHalfPasses,
        accurate_opposition_half: ss.accurateOppositionHalfPasses,
        total_opposition_half: ss.totalOppositionHalfPasses,
        accurate_long_balls: ss.accurateLongBalls,
        accurate_long_balls_pct: ss.accurateLongBallsPercentage,
        total_long_balls: ss.totalLongBalls,
        accurate_chipped_passes: ss.accurateChippedPasses,
        total_chipped_passes: ss.totalChippedPasses,
        accurate_crosses: ss.accurateCrosses,
        accurate_crosses_pct: ss.accurateCrossesPercentage,
        total_crosses: ss.totalCross,
      },

      defending: {
        interceptions: ss.interceptions,
        interceptions_per_game: ss.appearances ? +(ss.interceptions / ss.appearances).toFixed(1) : null,
        tackles: ss.tackles,
        tackles_won: ss.tacklesWon,
        tackles_won_pct: ss.tacklesWonPercentage,
        tackles_per_game: ss.appearances ? +(ss.tackles / ss.appearances).toFixed(1) : null,
        possession_won_final_third: ss.possessionWonAttThird,
        ball_recovery: ss.ballRecovery,
        ball_recovery_per_game: ss.appearances ? +(ss.ballRecovery / ss.appearances).toFixed(1) : null,
        dribbled_past: ss.dribbledPast,
        dribbled_past_per_game: ss.appearances ? +(ss.dribbledPast / ss.appearances).toFixed(1) : null,
        clearances: ss.clearances,
        clearances_per_game: ss.appearances ? +(ss.clearances / ss.appearances).toFixed(1) : null,
        blocked_shots: ss.blockedShots,
        blocked_shots_per_game: ss.appearances ? +(ss.blockedShots / ss.appearances).toFixed(1) : null,
        errors_leading_to_shot: ss.errorLeadToShot,
        errors_leading_to_goal: ss.errorLeadToGoal,
        penalties_committed: ss.penaltyConceded,
      },

      other_per_game: {
        successful_dribbles: ss.successfulDribbles,
        successful_dribbles_pct: ss.successfulDribblesPercentage,
        successful_dribbles_per_game: ss.appearances ? +(ss.successfulDribbles / ss.appearances).toFixed(1) : null,
        total_duels_won: ss.totalDuelsWon,
        total_duels_won_pct: ss.totalDuelsWonPercentage,
        total_duels_per_game: ss.appearances ? +((ss.totalDuelsWon + (ss.duelLost || 0)) / ss.appearances).toFixed(1) : null,
        ground_duels_won: ss.groundDuelsWon,
        ground_duels_won_pct: ss.groundDuelsWonPercentage,
        ground_duels_per_game: ss.appearances ? +((ss.groundDuelsWon + Math.round(ss.groundDuelsWon / (ss.groundDuelsWonPercentage / 100) - ss.groundDuelsWon)) / ss.appearances).toFixed(1) : null,
        aerial_duels_won: ss.aerialDuelsWon,
        aerial_duels_won_pct: ss.aerialDuelsWonPercentage,
        possession_lost: ss.possessionLost,
        possession_lost_per_game: ss.appearances ? +(ss.possessionLost / ss.appearances).toFixed(1) : null,
        fouls: ss.fouls,
        fouls_per_game: ss.appearances ? +(ss.fouls / ss.appearances).toFixed(1) : null,
        was_fouled: ss.wasFouled,
        was_fouled_per_game: ss.appearances ? +(ss.wasFouled / ss.appearances).toFixed(1) : null,
        offsides: ss.offsides,
        offsides_per_game: ss.appearances ? +(ss.offsides / ss.appearances).toFixed(1) : null,
      },

      cards: {
        yellow: ss.yellowCards,
        yellow_red: ss.yellowRedCards,
        red: ss.redCards,
        direct_red: ss.directRedCards,
      },

      rating: ss.rating,
    },
  };

  // Output JSON to stdout
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
}

// Helpers
function captureApi(page: Page, pattern: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { page.removeListener('response', handler); reject(new Error(`Timeout`)); }, timeoutMs);
    const handler = async (response: any) => {
      const u = response.url();
      if (u.includes('www.sofascore.com/api/v1') && u.includes(pattern) && response.status() === 200) {
        try { const j = await response.json(); clearTimeout(timer); page.removeListener('response', handler); resolve(j); } catch {}
      }
    };
    page.on('response', handler);
  });
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error(e); process.exit(1); });
