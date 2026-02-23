/**
 * Crawl SofaScore data for players from player_stats,
 * then merge and upsert into oddsflow_player_statistics.
 *
 * Usage:
 *   npx ts-node src/crawl-team.ts "Manchester United"          # single team
 *   npx ts-node src/crawl-team.ts --league "Premier League"    # all teams in league
 *   npx ts-node src/crawl-team.ts --all                        # all 5 leagues
 *
 * Options:
 *   --headed    Show browser window
 *   --debug     Enable debug logging
 */
import dotenv from 'dotenv';
dotenv.config();

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { chromium, Page, BrowserContext } from 'playwright';
import { captureMultipleApiResponses, extractNextData } from './browser/interceptor';
import { delay } from './utils/delay';
import { ENV } from './config/env';

// ── Config ──

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

function log(level: string, msg: string) {
  const levels: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  if ((levels[level] ?? 1) >= (levels[LOG_LEVEL] ?? 1)) {
    const time = new Date().toISOString().slice(11, 19);
    console.error(`[${time}] [${level.toUpperCase()}] ${msg}`);
  }
}

// ── League → Tournament ID ──

const LEAGUE_TOURNAMENT_MAP: Record<string, number> = {
  'Premier League': 17,
  'La Liga': 8,
  'Bundesliga': 35,
  'Serie A': 23,
  'Ligue 1': 34,
  'UEFA Champions League': 7,
};

// ── Team Name Aliases ──
// Maps player_stats names → possible SofaScore names (for fuzzy matching)
const TEAM_NAME_ALIASES: Record<string, string[]> = {
  // Premier League
  'Newcastle': ['Newcastle United'],
  'Tottenham': ['Tottenham Hotspur'],
  'West Ham': ['West Ham United'],
  'Wolves': ['Wolverhampton Wanderers', 'Wolverhampton'],
  'Brighton': ['Brighton & Hove Albion', 'Brighton and Hove Albion'],
  'Leeds': ['Leeds United'],
  'Burnley': ['Burnley FC'],
  'Sunderland': ['Sunderland AFC'],
  // Bundesliga
  'Bayern München': ['Bayern Munich', 'FC Bayern München', 'Bayern München'],
  'Borussia Mönchengladbach': ['Borussia Mönchengladbach', 'Borussia Monchengladbach'],
  'FSV Mainz 05': ['1. FSV Mainz 05', 'Mainz 05', 'Mainz'],
  'Union Berlin': ['1. FC Union Berlin', 'Union Berlin'],
  '1. FC Heidenheim': ['FC Heidenheim 1846', 'FC Heidenheim', '1. FC Heidenheim 1846'],
  '1. FC Köln': ['1. FC Köln', 'FC Köln'],
  'Hamburger SV': ['Hamburger SV', 'HSV'],
  // La Liga
  'Barcelona': ['FC Barcelona', 'Barcelona'],
  'Athletic Club': ['Athletic Club', 'Athletic Bilbao'],
  'Atletico Madrid': ['Atlético de Madrid', 'Atlético Madrid', 'Club Atletico de Madrid'],
  'Oviedo': ['Real Oviedo'],
  'Levante': ['Levante UD'],
  'Elche': ['Elche CF'],
  // Serie A
  'Inter': ['Inter', 'Internazionale', 'FC Internazionale Milano'],
  'Verona': ['Hellas Verona'],
  'Cremonese': ['US Cremonese'],
  'Sassuolo': ['US Sassuolo'],
  'Pisa': ['AC Pisa 1909', 'Pisa Sporting Club'],
  'Como': ['Como 1907'],
  // Ligue 1
  'Paris Saint Germain': ['Paris Saint-Germain', 'PSG'],
  'Marseille': ['Olympique de Marseille', 'Olympique Marseille'],
  'Lyon': ['Olympique Lyonnais', 'Olympique Lyon'],
  'Lens': ['RC Lens'],
  'Lille': ['LOSC Lille', 'Lille OSC'],
  'Rennes': ['Stade Rennais FC', 'Stade Rennais'],
  'Strasbourg': ['RC Strasbourg Alsace', 'RC Strasbourg'],
  'Nantes': ['FC Nantes'],
  'Auxerre': ['AJ Auxerre'],
  'Angers': ['Angers SCO'],
  'Le Havre': ['Le Havre AC'],
  'Monaco': ['AS Monaco'],
  'Nice': ['OGC Nice'],
  'Toulouse': ['Toulouse FC'],
  'Stade Brestois 29': ['Stade Brestois 29', 'Brest'],
  'Lorient': ['FC Lorient'],
  'Metz': ['FC Metz'],
  'Paris FC': ['Paris FC'],
  'Montpellier': ['Montpellier HSC'],
};

// ── CLI Args ──

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const debug = args.includes('--debug');
const allLeagues = args.includes('--all');

if (debug) process.env.LOG_LEVEL = 'debug';

// Parse --league "name"
function getArgValue(flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return null;
}

const leagueName = getArgValue('--league');
const teamName = args.find(a => !a.startsWith('--') && a !== leagueName);

if (!teamName && !leagueName && !allLeagues) {
  console.log(`
Usage:
  npx ts-node src/crawl-team.ts "<team-name>" [options]      # single team
  npx ts-node src/crawl-team.ts --league "<league>" [options] # all teams in league
  npx ts-node src/crawl-team.ts --all [options]               # all 5 leagues

Options:
  --headed    Show browser window
  --debug     Enable debug logging

Leagues: Premier League, La Liga, Bundesliga, Serie A, Ligue 1

Examples:
  npx ts-node src/crawl-team.ts "Manchester United"
  npx ts-node src/crawl-team.ts "Arsenal" --headed --debug
  npx ts-node src/crawl-team.ts --league "Premier League"
  npx ts-node src/crawl-team.ts --league "La Liga" --debug
  npx ts-node src/crawl-team.ts --all
`);
  process.exit(0);
}

// ── Supabase Client ──

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY/SUPABASE_ANON_KEY in .env');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Types ──

interface PlayerStatsRow {
  player_id: number;
  player_name: string;
  [key: string]: any;
}

interface SofascoreMapping {
  player_id: number;
  sofascore_id: number;
  sofascore_name: string;
}

interface SofascorePlayerLink {
  sofascoreId: number;
  slug: string;
  name: string;
}

interface SofascoreTeamInfo {
  id: number;
  slug: string;
  name: string;
}

// ── Step 1: Read players from player_stats ──

async function getPlayersFromStats(team: string): Promise<PlayerStatsRow[]> {
  log('info', `Reading player_stats for team: ${team}`);
  const { data, error } = await supabase
    .from('player_stats')
    .select('*')
    .eq('team_name', team);

  if (error) {
    log('error', `Failed to query player_stats: ${error.message}`);
    return [];
  }
  log('info', `Found ${data?.length || 0} players in player_stats`);
  return data || [];
}

// ── Get distinct teams for a league from player_stats ──

async function getTeamsForLeague(league: string): Promise<string[]> {
  log('info', `Querying teams for league: ${league}`);
  const { data, error } = await supabase
    .from('player_stats')
    .select('team_name')
    .eq('league_name', league);

  if (error) {
    log('error', `Failed to query teams: ${error.message}`);
    return [];
  }

  const teams = [...new Set((data || []).map(r => r.team_name).filter(Boolean))].sort();
  log('info', `Found ${teams.length} teams in ${league}`);
  return teams;
}

// ── Get league for a team from player_stats ──

async function getLeagueForTeam(team: string): Promise<string | null> {
  const { data } = await supabase
    .from('player_stats')
    .select('league_name')
    .eq('team_name', team)
    .limit(1);

  return data?.[0]?.league_name || null;
}

// ── Step 2: Get SofaScore ID mapping from players_oddsflow_merged ──

async function getSofascoreMappings(playerIds: number[]): Promise<Map<number, SofascoreMapping>> {
  log('info', `Checking sofascore_id mappings for ${playerIds.length} players...`);
  const map = new Map<number, SofascoreMapping>();

  for (let i = 0; i < playerIds.length; i += 50) {
    const batch = playerIds.slice(i, i + 50);
    const { data } = await supabase
      .from('players_oddsflow_merged')
      .select('player_id, sofascore_id, sofascore_name')
      .in('player_id', batch);

    if (data) {
      for (const row of data) {
        if (row.sofascore_id) {
          map.set(row.player_id, row);
        }
      }
    }
  }

  log('info', `Found ${map.size}/${playerIds.length} sofascore_id mappings`);
  return map;
}

// ── Auto-discover SofaScore teams from standings API ──

async function discoverSofascoreTeams(
  page: Page,
  tournamentId: number
): Promise<Map<string, SofascoreTeamInfo>> {
  log('info', `Discovering SofaScore teams for tournament ${tournamentId}...`);

  const result = await page.evaluate(async (tId: number) => {
    try {
      // Get current season
      const seasonsRes = await fetch(
        `https://www.sofascore.com/api/v1/unique-tournament/${tId}/seasons`
      );
      if (!seasonsRes.ok) return { error: 'seasons_fetch_failed' };
      const seasonsData = await seasonsRes.json();
      const seasonId = seasonsData?.seasons?.[0]?.id;
      if (!seasonId) return { error: 'no_season_found' };

      // Get standings
      const standingsRes = await fetch(
        `https://www.sofascore.com/api/v1/unique-tournament/${tId}/season/${seasonId}/standings/total`
      );
      if (!standingsRes.ok) return { error: 'standings_fetch_failed' };
      const standingsData = await standingsRes.json();

      const teams: { id: number; slug: string; name: string }[] = [];
      const groups = standingsData?.standings || [];
      for (const group of groups) {
        for (const row of (group.rows || [])) {
          if (row.team) {
            teams.push({
              id: row.team.id,
              slug: row.team.slug,
              name: row.team.name || row.team.shortName,
            });
          }
        }
      }

      return { seasonId, teams };
    } catch (e: any) {
      return { error: e.message };
    }
  }, tournamentId);

  const teamsMap = new Map<string, SofascoreTeamInfo>();

  if ('error' in result) {
    log('warn', `Failed to discover teams: ${result.error}`);
    return teamsMap;
  }

  log('info', `Discovered ${result.teams?.length || 0} teams (season ${result.seasonId})`);
  for (const t of (result.teams || [])) {
    teamsMap.set(t.name, { id: t.id, slug: t.slug, name: t.name });
  }

  return teamsMap;
}

// ── Fuzzy match team name ──

function normalizeName(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findSofascoreTeamMatch(
  playerStatsName: string,
  sofascoreTeams: Map<string, SofascoreTeamInfo>
): SofascoreTeamInfo | null {
  const normTarget = normalizeName(playerStatsName);

  // Strategy 1: Exact match
  for (const [name, info] of sofascoreTeams) {
    if (name.toLowerCase() === playerStatsName.toLowerCase()) {
      return info;
    }
  }

  // Strategy 2: Normalized exact match
  for (const [name, info] of sofascoreTeams) {
    if (normalizeName(name) === normTarget) {
      return info;
    }
  }

  // Strategy 3: One name contains the other
  for (const [name, info] of sofascoreTeams) {
    const normName = normalizeName(name);
    if (normName.includes(normTarget) || normTarget.includes(normName)) {
      // Avoid false positives for very short names (e.g., "Nice" matching "Monaco")
      if (normTarget.length >= 4 || normName.length >= 4) {
        return info;
      }
    }
  }

  // Strategy 4: Check aliases
  const aliases = TEAM_NAME_ALIASES[playerStatsName];
  if (aliases) {
    for (const alias of aliases) {
      const normAlias = normalizeName(alias);
      for (const [name, info] of sofascoreTeams) {
        const normName = normalizeName(name);
        if (normName === normAlias) return info;
        if (normName.includes(normAlias) || normAlias.includes(normName)) {
          return info;
        }
      }
    }
  }

  // Strategy 5: First significant word match (for "Newcastle" → "Newcastle United")
  const targetWords = normTarget.split(' ').filter(w => w.length >= 4);
  for (const [name, info] of sofascoreTeams) {
    const nameWords = normalizeName(name).split(' ').filter(w => w.length >= 4);
    const overlap = targetWords.filter(w => nameWords.includes(w));
    if (overlap.length > 0 && overlap.length >= Math.min(targetWords.length, nameWords.length) * 0.5) {
      return info;
    }
  }

  return null;
}

// ── Fallback: find SofaScore player IDs from team page ──

async function findSofascorePlayersFromTeamPage(
  page: Page,
  sofascoreTeamId: number,
  teamSlug: string
): Promise<SofascorePlayerLink[]> {
  // Use the /players API endpoint directly (more reliable than DOM parsing)
  log('info', `Fetching players for SofaScore team ${teamSlug}/${sofascoreTeamId}...`);

  const result = await page.evaluate(async ({ teamId }: { teamId: number }) => {
    try {
      const res = await fetch(`https://www.sofascore.com/api/v1/team/${teamId}/players`);
      if (!res.ok) return { error: `HTTP ${res.status}` };
      return await res.json();
    } catch (e: any) {
      return { error: e.message };
    }
  }, { teamId: sofascoreTeamId });

  if ('error' in result) {
    log('warn', `Failed to fetch team players API: ${result.error}`);
    // Fallback: try DOM parsing
    return await findSofascorePlayersFromDOM(page, sofascoreTeamId, teamSlug);
  }

  const players: SofascorePlayerLink[] = [];
  const seen = new Set<number>();

  for (const item of (result.players || [])) {
    const p = item.player;
    if (p && p.id && !seen.has(p.id)) {
      seen.add(p.id);
      players.push({
        sofascoreId: p.id,
        slug: p.slug || p.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || '',
        name: p.name || p.shortName || '',
      });
    }
  }

  log('info', `Found ${players.length} players from team players API`);
  return players;
}

async function findSofascorePlayersFromDOM(
  page: Page,
  sofascoreTeamId: number,
  teamSlug: string
): Promise<SofascorePlayerLink[]> {
  const url = `https://www.sofascore.com/football/team/${teamSlug}/${sofascoreTeamId}`;
  log('info', `Fallback: loading team page DOM: ${url}`);

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await delay(3000);

  // Try clicking "Squad" or "Players" tab
  try {
    const tabs = await page.$$('a[role="tab"], button[role="tab"], [data-tabid]');
    for (const tab of tabs) {
      const text = await tab.textContent();
      if (text && /squad|players/i.test(text)) {
        await tab.click();
        await delay(3000);
        break;
      }
    }
  } catch {}

  await delay(5000);

  const players = await page.evaluate(() => {
    const results: { sofascoreId: number; slug: string; name: string }[] = [];
    const links = Array.from(document.querySelectorAll('a[href*="/football/player/"]'));
    const seen = new Set<number>();

    for (let i = 0; i < links.length; i++) {
      const a = links[i] as HTMLAnchorElement;
      const href = a.getAttribute('href') || '';
      const match = href.match(/\/football\/player\/([^/]+)\/(\d+)/);
      if (match) {
        const id = parseInt(match[2], 10);
        if (!seen.has(id)) {
          seen.add(id);
          results.push({ sofascoreId: id, slug: match[1], name: a.textContent?.trim() || '' });
        }
      }
    }
    return results;
  });

  log('info', `Found ${players.length} players from team page DOM`);
  return players;
}

function matchPlayerByName(
  playerName: string,
  sofascorePlayers: SofascorePlayerLink[]
): SofascorePlayerLink | null {
  const normalize = (s: string) => s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '').trim();

  const targetNorm = normalize(playerName);
  const parts = targetNorm.split(/\s+/);
  const lastName = parts[parts.length - 1];

  // 1. Exact match
  for (const sp of sofascorePlayers) {
    if (normalize(sp.name) === targetNorm) return sp;
  }

  // 2. Full name contains
  for (const sp of sofascorePlayers) {
    const spNorm = normalize(sp.name);
    if (spNorm.includes(targetNorm) || targetNorm.includes(spNorm)) return sp;
  }

  // 3. Last name match
  for (const sp of sofascorePlayers) {
    const spParts = normalize(sp.name).split(/\s+/);
    const spLastName = spParts[spParts.length - 1];
    if (spLastName === lastName && lastName.length >= 3) return sp;
  }

  return null;
}

// ── Step 4: Crawl SofaScore data for a single player ──

async function crawlSofascorePlayer(
  page: Page,
  sofascoreId: number,
  slug: string,
  playerName: string,
  tournamentId: number,
): Promise<any> {
  const url = `https://www.sofascore.com/football/player/${slug}/${sofascoreId}`;
  log('info', `Crawling: ${playerName} → ${url}`);

  const attrPattern = `player/${sofascoreId}/attribute-overviews`;
  const charPattern = `player/${sofascoreId}/characteristics`;
  const ntPattern = `player/${sofascoreId}/national-team-statistics`;

  const capturePromise = captureMultipleApiResponses(
    page, [attrPattern, charPattern, ntPattern], 20000
  );

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await delay(4000);

  // SSR data
  const nextData = await extractNextData(page);
  const ip = nextData?.props?.pageProps?.initialProps;
  const p = ip?.player || {};
  const transfers = ip?.transfers || [];

  // API data
  const apiResults: Record<string, any> = await capturePromise.catch(() => ({}));
  const attrData = apiResults[attrPattern];
  const charData = apiResults[charPattern];
  const ntData = apiResults[ntPattern];

  // Attributes
  const attrs = attrData?.playerAttributeOverviews?.find((a: any) => a.yearShift === 0)
    || attrData?.playerAttributeOverviews?.[0];

  // Strengths/weaknesses from DOM
  const { strengths, weaknesses } = await extractStrengthsWeaknesses(page);

  // Season stats via in-browser fetch
  let seasonStats: any = null;
  const seasonId = await discoverCurrentSeason(page, tournamentId);
  if (seasonId) {
    const statsUrl = `https://www.sofascore.com/api/v1/player/${sofascoreId}/unique-tournament/${tournamentId}/season/${seasonId}/statistics/overall`;
    seasonStats = await page.evaluate(async (u: string) => {
      try {
        const res = await fetch(u);
        return res.ok ? await res.json() : null;
      } catch { return null; }
    }, statsUrl);
  }

  return {
    sofascore_id: sofascoreId,
    slug,
    profile: {
      name: p.name,
      position: p.position,
      height: p.height,
      preferred_foot: p.preferredFoot,
      country: p.country?.name,
      date_of_birth: p.dateOfBirthTimestamp
        ? new Date(p.dateOfBirthTimestamp * 1000).toISOString().slice(0, 10)
        : null,
      shirt_number: p.shirtNumber,
      team: { id: p.team?.id, name: p.team?.name },
      market_value: p.proposedMarketValue,
      market_value_currency: p.proposedMarketValueRaw?.currency,
    },
    positions: charData?.positions || [],
    attribute_overview: attrs ? {
      attacking: attrs.attacking,
      technical: attrs.technical,
      tactical: attrs.tactical,
      defending: attrs.defending,
      creativity: attrs.creativity,
    } : null,
    strengths,
    weaknesses: weaknesses.length > 0 ? weaknesses : null,
    national_team: ntData?.statistics?.[0] ? {
      team: ntData.statistics[0].team?.name,
      appearances: ntData.statistics[0].appearances,
      goals: ntData.statistics[0].goals,
      debut: ntData.statistics[0].debutTimestamp
        ? new Date(ntData.statistics[0].debutTimestamp * 1000).toISOString().slice(0, 10)
        : null,
    } : null,
    transfer_history: transfers.map((t: any) => ({
      from_team: t.transferFrom?.name || t.fromTeamName,
      to_team: t.transferTo?.name || t.toTeamName,
      fee_display: t.transferFeeDescription,
      fee_currency: t.transferFeeRaw?.currency,
      date: t.transferDateTimestamp
        ? new Date(t.transferDateTimestamp * 1000).toISOString().slice(0, 10)
        : null,
      type: t.type,
    })),
    season_statistics: seasonStats?.statistics || null,
    raw_attributes: attrData || null,
    raw_characteristics: charData || null,
    raw_national_team: ntData || null,
    raw_season_stats: seasonStats || null,
  };
}

// ── Helpers ──

async function discoverCurrentSeason(page: Page, tournamentId: number): Promise<number | null> {
  try {
    const result = await page.evaluate(async (utId: number) => {
      const res = await fetch(`https://www.sofascore.com/api/v1/unique-tournament/${utId}/seasons`);
      return res.ok ? await res.json() : null;
    }, tournamentId);
    return result?.seasons?.[0]?.id || null;
  } catch {
    return null;
  }
}

async function extractStrengthsWeaknesses(page: Page): Promise<{
  strengths: string[];
  weaknesses: string[];
}> {
  try {
    return await page.evaluate(() => {
      const s: string[] = [];
      const w: string[] = [];
      const posCodes = new Set([
        'GK','CB','LB','RB','LWB','RWB','DM','MC','ML','MR','AM','LW','RW','CF','ST','F','M','D',
      ]);
      const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(Boolean);
      let sec: 'none'|'s'|'w' = 'none';
      for (const line of lines) {
        if (line === 'Strengths') { sec = 's'; continue; }
        if (line === 'Weaknesses') { sec = 'w'; continue; }
        if (sec !== 'none' && (posCodes.has(line) ||
          ['Player positions','Player value','Attribute Overview','Transfer history','National team']
            .includes(line) || line.startsWith('Search to compare'))) {
          sec = 'none'; continue;
        }
        const ok = line.length >= 4 && !posCodes.has(line) &&
          !line.startsWith('No outstanding');
        if (sec === 's' && ok) s.push(line);
        if (sec === 'w' && ok) w.push(line);
      }
      return { strengths: s, weaknesses: w };
    });
  } catch {
    return { strengths: [], weaknesses: [] };
  }
}

// ── Step 5: Write to oddsflow_player_statistics ──

async function upsertOddsflowPlayerStats(data: {
  player_id: number;
  player_name: string;
  team_name: string;
  supabase_original_data: any;
  sofascore_data: any;
}): Promise<void> {
  const row = {
    ...data,
    data_collection_date: new Date().toISOString().slice(0, 10),
  };

  const { error } = await supabase
    .from('oddsflow_player_statistics')
    .upsert(row, { onConflict: 'player_id' });

  if (error) {
    log('error', `Failed to upsert ${data.player_name}: ${error.message}`);
    throw error;
  }
  log('info', `Upserted: ${data.player_name}`);
}

// ── Crawl all players for one team ──

async function crawlTeamPlayers(
  page: Page,
  team: string,
  tournamentId: number,
  sofascoreTeamInfo: SofascoreTeamInfo | null,
): Promise<{ success: number; failed: number; skipped: number }> {
  log('info', `\n${'='.repeat(50)}`);
  log('info', `Crawling team: ${team}`);
  log('info', `${'='.repeat(50)}`);

  // 1. Read players from player_stats
  const players = await getPlayersFromStats(team);
  if (players.length === 0) {
    log('warn', `No players found for "${team}" in player_stats — skipping`);
    return { success: 0, failed: 0, skipped: 0 };
  }

  // 2. Get SofaScore ID mappings
  const playerIds = players.map(p => p.player_id);
  const mappings = await getSofascoreMappings(playerIds);

  // 3. For unmapped players, find from SofaScore team players API
  const unmapped = players.filter(p => !mappings.has(p.player_id));
  let sofascoreTeamPlayers: SofascorePlayerLink[] = [];

  if (unmapped.length > 0 && sofascoreTeamInfo) {
    sofascoreTeamPlayers = await findSofascorePlayersFromTeamPage(
      page, sofascoreTeamInfo.id, sofascoreTeamInfo.slug
    );
    await delay(3000);
  }

  // 4. Crawl each player
  let success = 0, failed = 0, skipped = 0;

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const mapping = mappings.get(player.player_id);

    let sofascoreId: number | null = null;
    let slug = '';

    if (mapping) {
      sofascoreId = mapping.sofascore_id;
      slug = mapping.sofascore_name.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    } else {
      const match = matchPlayerByName(player.player_name, sofascoreTeamPlayers);
      if (match) {
        sofascoreId = match.sofascoreId;
        slug = match.slug;
        log('info', `Name matched: ${player.player_name} → ${match.name} (${match.sofascoreId})`);
      }
    }

    if (!sofascoreId) {
      log('warn', `[${i + 1}/${players.length}] SKIP: ${player.player_name} — no SofaScore ID found`);
      skipped++;
      continue;
    }

    log('info', `\n[${i + 1}/${players.length}] ${player.player_name} → SofaScore ID: ${sofascoreId}`);

    try {
      const sofascoreData = await crawlSofascorePlayer(
        page, sofascoreId, slug, player.player_name, tournamentId
      );

      // Strip language/large fields from original data
      const { bio_language, bio, player_name_language, first_name_language,
              last_name_language, title_language, nationality_language,
              team_name_language, ...cleanOriginal } = player;

      await upsertOddsflowPlayerStats({
        player_id: player.player_id,
        player_name: player.player_name,
        team_name: team,
        supabase_original_data: cleanOriginal,
        sofascore_data: sofascoreData,
      });

      success++;
      log('info', `[${i + 1}/${players.length}] ${player.player_name} done. Waiting ${ENV.PLAYER_DELAY_MS / 1000}s...`);

      if (i < players.length - 1) {
        await delay(ENV.PLAYER_DELAY_MS);
      }
    } catch (err) {
      log('error', `[${i + 1}/${players.length}] FAILED: ${player.player_name} — ${(err as Error).message}`);
      failed++;
    }
  }

  return { success, failed, skipped };
}

// ── Crawl all teams in a league ──

async function crawlLeague(
  page: Page,
  league: string,
  sofascoreTeamsCache: Map<string, SofascoreTeamInfo>
): Promise<void> {
  log('info', `\n${'#'.repeat(60)}`);
  log('info', `# LEAGUE: ${league}`);
  log('info', `${'#'.repeat(60)}`);

  const tournamentId = LEAGUE_TOURNAMENT_MAP[league];
  if (!tournamentId) {
    log('error', `Unknown league: ${league}. Available: ${Object.keys(LEAGUE_TOURNAMENT_MAP).join(', ')}`);
    return;
  }

  // Get teams from player_stats
  const teams = await getTeamsForLeague(league);
  if (teams.length === 0) {
    log('warn', `No teams found for "${league}" in player_stats`);
    return;
  }

  // Discover SofaScore teams (if not cached for this tournament)
  let sofascoreTeams = sofascoreTeamsCache;
  if (sofascoreTeams.size === 0) {
    // Need to navigate to SofaScore first to use in-browser fetch
    await page.goto('https://www.sofascore.com/football', { waitUntil: 'load', timeout: 30000 });
    await delay(2000);
    sofascoreTeams = await discoverSofascoreTeams(page, tournamentId);
    await delay(2000);
  }

  log('info', `\nMatching ${teams.length} player_stats teams to SofaScore...`);

  let totalSuccess = 0, totalFailed = 0, totalSkipped = 0;
  const matchResults: { team: string; matched: boolean; sofascoreName?: string }[] = [];

  // Match all teams first and show summary
  for (const team of teams) {
    const match = findSofascoreTeamMatch(team, sofascoreTeams);
    matchResults.push({
      team,
      matched: !!match,
      sofascoreName: match?.name,
    });
    if (match) {
      log('info', `  ✓ ${team} → ${match.name} (ID: ${match.id})`);
    } else {
      log('warn', `  ✗ ${team} → NO MATCH (will skip)`);
    }
  }

  const matchedCount = matchResults.filter(r => r.matched).length;
  log('info', `\nMatched: ${matchedCount}/${teams.length} teams\n`);

  // Crawl matched teams
  for (let t = 0; t < teams.length; t++) {
    const team = teams[t];
    const sofascoreTeamInfo = findSofascoreTeamMatch(team, sofascoreTeams);

    if (!sofascoreTeamInfo) {
      log('warn', `Skipping team "${team}" — no SofaScore match`);
      continue;
    }

    log('info', `\n[Team ${t + 1}/${teams.length}] ${team} → ${sofascoreTeamInfo.name}`);

    const result = await crawlTeamPlayers(page, team, tournamentId, sofascoreTeamInfo);
    totalSuccess += result.success;
    totalFailed += result.failed;
    totalSkipped += result.skipped;

    // Delay between teams
    if (t < teams.length - 1) {
      log('info', `Team done. Waiting 30s before next team...`);
      await delay(30000);
    }
  }

  log('info', `\n${'='.repeat(50)}`);
  log('info', `League Complete: ${league}`);
  log('info', `Teams: ${matchedCount}/${teams.length} matched`);
  log('info', `Players: ${totalSuccess} success | ${totalFailed} failed | ${totalSkipped} skipped`);
  log('info', `${'='.repeat(50)}`);
}

// ── Main ──

async function main() {
  const startTime = Date.now();

  // Launch browser
  const browser = await chromium.launch({
    headless: !headed,
    channel: 'chrome',
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  await context.route(/\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot)(\?.*)?$/, r => r.abort());
  const page = await context.newPage();

  try {
    if (allLeagues) {
      // ── Mode: All 5 Leagues ──
      log('info', `====================================`);
      log('info', `SofaScore Crawl: ALL 5 LEAGUES`);
      log('info', `====================================`);

      const leagues = ['Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1'];
      for (const league of leagues) {
        const sofascoreTeams = new Map<string, SofascoreTeamInfo>();
        await crawlLeague(page, league, sofascoreTeams);

        // Longer delay between leagues
        log('info', `\nLeague "${league}" done. Waiting 60s before next league...\n`);
        await delay(60000);
      }

    } else if (leagueName) {
      // ── Mode: Single League ──
      log('info', `====================================`);
      log('info', `SofaScore Crawl: ${leagueName}`);
      log('info', `====================================`);

      const sofascoreTeams = new Map<string, SofascoreTeamInfo>();
      await crawlLeague(page, leagueName, sofascoreTeams);

    } else if (teamName) {
      // ── Mode: Single Team ──
      log('info', `====================================`);
      log('info', `SofaScore Crawl: ${teamName}`);
      log('info', `====================================`);

      // Find which league this team belongs to
      const league = await getLeagueForTeam(teamName);
      const tournamentId = league ? (LEAGUE_TOURNAMENT_MAP[league] || 17) : 17;
      log('info', `League: ${league || 'unknown'} (tournament ${tournamentId})`);

      // Navigate to SofaScore to enable in-browser fetch
      await page.goto('https://www.sofascore.com/football', { waitUntil: 'load', timeout: 30000 });
      await delay(2000);

      // Auto-discover SofaScore teams
      const sofascoreTeams = await discoverSofascoreTeams(page, tournamentId);
      await delay(2000);

      // Match team
      const sofascoreTeamInfo = findSofascoreTeamMatch(teamName, sofascoreTeams);
      if (sofascoreTeamInfo) {
        log('info', `Matched: ${teamName} → ${sofascoreTeamInfo.name} (ID: ${sofascoreTeamInfo.id})`);
      } else {
        log('warn', `Could not auto-match "${teamName}" to SofaScore. Will rely on player ID mappings only.`);
      }

      const result = await crawlTeamPlayers(page, teamName, tournamentId, sofascoreTeamInfo);

      log('info', `\n====================================`);
      log('info', `Crawl Complete: ${teamName}`);
      log('info', `Success: ${result.success} | Failed: ${result.failed} | Skipped: ${result.skipped}`);
      log('info', `====================================`);
    }
  } finally {
    await browser.close();
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  log('info', `\nTotal time: ${mins}m ${secs}s`);
}

main().catch(err => {
  log('error', `Fatal: ${err.message}`);
  process.exit(1);
});
