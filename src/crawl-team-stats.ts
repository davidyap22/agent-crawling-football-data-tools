/**
 * Crawl SofaScore team statistics (Attacking/Passes/Defending/Other),
 * merge with team_statistics from Supabase, and upsert into oddsflow_team_statistics.
 *
 * Usage:
 *   npx ts-node src/crawl-team-stats.ts --team "Arsenal"              # single team
 *   npx ts-node src/crawl-team-stats.ts --league "Premier League"     # single league
 *   npx ts-node src/crawl-team-stats.ts --all                         # all 5 leagues + UCL
 *
 * Options:
 *   --headed    Show browser window
 *   --debug     Enable debug logging
 */
import dotenv from 'dotenv';
dotenv.config();

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { chromium, Page } from 'playwright';
import { delay } from './utils/delay';

// ── Config ──

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const PAGE_DELAY_MS = parseInt(process.env.PAGE_DELAY_MS || '120000', 10);

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
// Maps team_statistics names → possible SofaScore names (for fuzzy matching)
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

function getArgValue(flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return null;
}

const leagueName = getArgValue('--league');
const teamNameArg = getArgValue('--team');

if (!teamNameArg && !leagueName && !allLeagues) {
  console.log(`
Usage:
  npx ts-node src/crawl-team-stats.ts --team "<team-name>" [options]    # single team
  npx ts-node src/crawl-team-stats.ts --league "<league>" [options]     # all teams in league
  npx ts-node src/crawl-team-stats.ts --all [options]                   # all 6 leagues

Options:
  --headed    Show browser window
  --debug     Enable debug logging

Leagues: Premier League, La Liga, Bundesliga, Serie A, Ligue 1, UEFA Champions League

Examples:
  npx ts-node src/crawl-team-stats.ts --team "Arsenal"
  npx ts-node src/crawl-team-stats.ts --team "Arsenal" --headed --debug
  npx ts-node src/crawl-team-stats.ts --league "Premier League"
  npx ts-node src/crawl-team-stats.ts --league "La Liga" --debug
  npx ts-node src/crawl-team-stats.ts --all
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

interface TeamStatsRow {
  team_id: number;
  team_name: string;
  league_name: string;
  [key: string]: any;
}

interface SofascoreTeamInfo {
  id: number;
  slug: string;
  name: string;
}

// ── Read teams from team_statistics ──

async function getTeamsFromStats(league: string): Promise<TeamStatsRow[]> {
  log('info', `Reading team_statistics for league: ${league}`);
  const { data, error } = await supabase
    .from('team_statistics')
    .select('*')
    .eq('league_name', league);

  if (error) {
    log('error', `Failed to query team_statistics: ${error.message}`);
    return [];
  }
  log('info', `Found ${data?.length || 0} teams in team_statistics for ${league}`);
  return data || [];
}

async function getTeamRowsFromStats(teamName: string, league?: string): Promise<TeamStatsRow[]> {
  log('info', `Reading team_statistics for team: ${teamName}${league ? ` (${league})` : ' (all leagues)'}`);
  let query = supabase
    .from('team_statistics')
    .select('*')
    .ilike('team_name', teamName);

  if (league) {
    query = query.eq('league_name', league);
  }

  const { data, error } = await query;

  if (error) {
    log('error', `Failed to query team_statistics: ${error.message}`);
    return [];
  }
  return data || [];
}

// ── Auto-discover SofaScore teams from standings API ──

async function discoverSofascoreTeams(
  page: Page,
  tournamentId: number
): Promise<{ teams: Map<string, SofascoreTeamInfo>; seasonId: number | null }> {
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
    return { teams: teamsMap, seasonId: null };
  }

  log('info', `Discovered ${result.teams?.length || 0} teams (season ${result.seasonId})`);
  for (const t of (result.teams || [])) {
    teamsMap.set(t.name, { id: t.id, slug: t.slug, name: t.name });
  }

  return { teams: teamsMap, seasonId: result.seasonId ?? null };
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
  statsName: string,
  sofascoreTeams: Map<string, SofascoreTeamInfo>
): SofascoreTeamInfo | null {
  const normTarget = normalizeName(statsName);

  // Strategy 1: Exact match
  for (const [name, info] of sofascoreTeams) {
    if (name.toLowerCase() === statsName.toLowerCase()) {
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
      if (normTarget.length >= 4 || normName.length >= 4) {
        return info;
      }
    }
  }

  // Strategy 4: Check aliases
  const aliases = TEAM_NAME_ALIASES[statsName];
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

  // Strategy 5: First significant word match
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

// ── Fetch SofaScore team statistics ──

async function fetchTeamStatistics(
  page: Page,
  sofascoreTeamId: number,
  tournamentId: number,
  seasonId: number
): Promise<any> {
  const statsUrl = `https://www.sofascore.com/api/v1/team/${sofascoreTeamId}/unique-tournament/${tournamentId}/season/${seasonId}/statistics/overall`;
  log('debug', `Fetching: ${statsUrl}`);

  const result = await page.evaluate(async (u: string) => {
    try {
      const res = await fetch(u);
      return res.ok ? await res.json() : { error: `HTTP ${res.status}` };
    } catch (e: any) {
      return { error: e.message };
    }
  }, statsUrl);

  if (result?.error) {
    log('warn', `Failed to fetch team stats: ${result.error}`);
    return null;
  }

  return result;
}

// ── Upsert to oddsflow_team_statistics ──

async function upsertTeamStats(data: {
  team_id: number;
  team_name: string;
  league_name: string;
  season: number | null;
  supabase_original_data: any;
  sofascore_data: any;
}): Promise<void> {
  const row = {
    ...data,
    data_collection_date: new Date().toISOString().slice(0, 10),
  };

  const { error } = await supabase
    .from('oddsflow_team_statistics')
    .upsert(row, { onConflict: 'team_id,league_name' });

  if (error) {
    log('error', `Failed to upsert ${data.team_name}: ${error.message}`);
    throw error;
  }
  log('info', `Upserted: ${data.team_name} (${data.league_name})`);
}

// ── Check existing teams in oddsflow_team_statistics ──

async function getExistingTeamIds(league: string): Promise<Set<number>> {
  const { data } = await supabase
    .from('oddsflow_team_statistics')
    .select('team_id')
    .eq('league_name', league);

  const set = new Set<number>();
  for (const row of (data || [])) set.add(row.team_id);
  return set;
}

// ── Crawl a single team ──

async function crawlSingleTeam(
  page: Page,
  teamRow: TeamStatsRow,
  sofascoreTeamInfo: SofascoreTeamInfo,
  tournamentId: number,
  seasonId: number
): Promise<boolean> {
  log('info', `Crawling stats: ${teamRow.team_name} → ${sofascoreTeamInfo.name} (ID: ${sofascoreTeamInfo.id})`);

  const sofascoreData = await fetchTeamStatistics(
    page, sofascoreTeamInfo.id, tournamentId, seasonId
  );

  if (!sofascoreData) {
    log('warn', `No SofaScore stats for ${teamRow.team_name}`);
    return false;
  }

  log('debug', `SofaScore data keys: ${Object.keys(sofascoreData).join(', ')}`);

  await upsertTeamStats({
    team_id: teamRow.team_id,
    team_name: teamRow.team_name,
    league_name: teamRow.league_name,
    season: seasonId,
    supabase_original_data: teamRow,
    sofascore_data: sofascoreData,
  });

  return true;
}

// ── Crawl all teams in a league ──

async function crawlLeague(
  page: Page,
  league: string
): Promise<{ success: number; failed: number; skipped: number }> {
  log('info', `\n${'#'.repeat(60)}`);
  log('info', `# LEAGUE: ${league}`);
  log('info', `${'#'.repeat(60)}`);

  const tournamentId = LEAGUE_TOURNAMENT_MAP[league];
  if (!tournamentId) {
    log('error', `Unknown league: ${league}. Available: ${Object.keys(LEAGUE_TOURNAMENT_MAP).join(', ')}`);
    return { success: 0, failed: 0, skipped: 0 };
  }

  // Get teams from team_statistics
  const teamRows = await getTeamsFromStats(league);
  if (teamRows.length === 0) {
    log('warn', `No teams found for "${league}" in team_statistics`);
    return { success: 0, failed: 0, skipped: 0 };
  }

  // Discover SofaScore teams + seasonId
  const { teams: sofascoreTeams, seasonId } = await discoverSofascoreTeams(page, tournamentId);
  await delay(2000);

  if (!seasonId) {
    log('error', `Could not determine season for ${league}`);
    return { success: 0, failed: 0, skipped: 0 };
  }

  log('info', `\nMatching ${teamRows.length} team_statistics teams to SofaScore...`);

  // Match all teams first and show summary
  const matchResults: { row: TeamStatsRow; match: SofascoreTeamInfo | null }[] = [];
  for (const row of teamRows) {
    const match = findSofascoreTeamMatch(row.team_name, sofascoreTeams);
    matchResults.push({ row, match });
    if (match) {
      log('info', `  ✓ ${row.team_name} → ${match.name} (ID: ${match.id})`);
    } else {
      log('warn', `  ✗ ${row.team_name} → NO MATCH (will skip)`);
    }
  }

  const matchedCount = matchResults.filter(r => r.match).length;
  log('info', `\nMatched: ${matchedCount}/${teamRows.length} teams`);

  // Check existing (for resume)
  const existingIds = await getExistingTeamIds(league);
  if (existingIds.size > 0) {
    log('info', `Already crawled: ${existingIds.size} teams in ${league} (will skip)`);
  }
  log('info', '');

  // Crawl matched teams
  let success = 0, failed = 0, skipped = 0;

  for (let i = 0; i < matchResults.length; i++) {
    const { row, match } = matchResults[i];

    if (!match) {
      skipped++;
      continue;
    }

    if (existingIds.has(row.team_id)) {
      log('info', `[${i + 1}/${matchResults.length}] SKIP (exists): ${row.team_name}`);
      skipped++;
      continue;
    }

    log('info', `\n[${i + 1}/${matchResults.length}] ${row.team_name} → ${match.name}`);

    try {
      const ok = await crawlSingleTeam(page, row, match, tournamentId, seasonId);
      if (ok) {
        success++;
      } else {
        failed++;
      }
    } catch (err) {
      log('error', `FAILED: ${row.team_name} — ${(err as Error).message}`);
      failed++;
    }

    // Delay between teams
    if (i < matchResults.length - 1) {
      log('debug', `Waiting ${PAGE_DELAY_MS / 1000}s...`);
      await delay(PAGE_DELAY_MS);
    }
  }

  log('info', `\n${'='.repeat(50)}`);
  log('info', `League Complete: ${league}`);
  log('info', `Teams: ${matchedCount}/${teamRows.length} matched`);
  log('info', `Results: ${success} success | ${failed} failed | ${skipped} skipped`);
  log('info', `${'='.repeat(50)}`);

  return { success, failed, skipped };
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

  // Navigate to SofaScore first to enable in-browser fetch
  await page.goto('https://www.sofascore.com/football', { waitUntil: 'load', timeout: 30000 });
  await delay(2000);

  try {
    if (allLeagues) {
      // ── Mode: All Leagues ──
      log('info', `====================================`);
      log('info', `Team Stats Crawl: ALL LEAGUES`);
      log('info', `====================================`);

      const leagues = Object.keys(LEAGUE_TOURNAMENT_MAP);
      let totalSuccess = 0, totalFailed = 0, totalSkipped = 0;

      for (const league of leagues) {
        const result = await crawlLeague(page, league);
        totalSuccess += result.success;
        totalFailed += result.failed;
        totalSkipped += result.skipped;

        // Delay between leagues
        log('info', `\nLeague "${league}" done. Waiting 10s before next league...\n`);
        await delay(10000);
      }

      log('info', `\n${'#'.repeat(60)}`);
      log('info', `ALL LEAGUES COMPLETE`);
      log('info', `Total: ${totalSuccess} success | ${totalFailed} failed | ${totalSkipped} skipped`);
      log('info', `${'#'.repeat(60)}`);

    } else if (teamNameArg) {
      // ── Mode: Single Team (crawl all leagues the team appears in) ──
      log('info', `====================================`);
      log('info', `Team Stats Crawl: ${teamNameArg}`);
      log('info', `====================================`);

      // Find ALL entries for this team (could be in multiple leagues)
      const teamRows = await getTeamRowsFromStats(teamNameArg, leagueName || undefined);
      if (teamRows.length === 0) {
        log('error', `Team "${teamNameArg}" not found in team_statistics${leagueName ? ` for ${leagueName}` : ''}`);
        await browser.close();
        process.exit(1);
      }

      log('info', `Found ${teamRows.length} league entries: ${teamRows.map(r => r.league_name).join(', ')}`);

      let totalOk = 0, totalFail = 0;

      for (const teamRow of teamRows) {
        const league = teamRow.league_name;
        const tournamentId = LEAGUE_TOURNAMENT_MAP[league];
        if (!tournamentId) {
          log('warn', `Unknown league "${league}" — skipping`);
          totalFail++;
          continue;
        }

        log('info', `\n--- ${league} (tournament ${tournamentId}) ---`);

        // Discover SofaScore teams + seasonId
        const { teams: sofascoreTeams, seasonId } = await discoverSofascoreTeams(page, tournamentId);
        await delay(2000);

        if (!seasonId) {
          log('error', `Could not determine season for ${league}`);
          totalFail++;
          continue;
        }

        // Match team
        const sofascoreTeamInfo = findSofascoreTeamMatch(teamRow.team_name, sofascoreTeams);
        if (!sofascoreTeamInfo) {
          log('error', `Could not match "${teamRow.team_name}" to SofaScore in ${league}`);
          totalFail++;
          continue;
        }

        log('info', `Matched: ${teamRow.team_name} → ${sofascoreTeamInfo.name} (ID: ${sofascoreTeamInfo.id})`);

        const ok = await crawlSingleTeam(page, teamRow, sofascoreTeamInfo, tournamentId, seasonId);
        if (ok) totalOk++; else totalFail++;

        if (teamRows.indexOf(teamRow) < teamRows.length - 1) {
          await delay(PAGE_DELAY_MS);
        }
      }

      log('info', `\n====================================`);
      log('info', `Crawl Complete: ${teamNameArg}`);
      log('info', `Leagues: ${totalOk} success | ${totalFail} failed`);
      log('info', `====================================`);

    } else if (leagueName) {
      // ── Mode: Single League ──
      log('info', `====================================`);
      log('info', `Team Stats Crawl: ${leagueName}`);
      log('info', `====================================`);

      await crawlLeague(page, leagueName);
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
