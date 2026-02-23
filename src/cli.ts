import { validateEnv, ENV } from './config/env';
import { LEAGUES, findLeague, LeagueConfig } from './config/leagues';
import { launchBrowser, closeBrowser } from './browser/launcher';
import { captureApiResponse, captureMultipleApiResponses } from './browser/interceptor';
import { collectTeamStatistics } from './collectors/team-statistics';
import { collectTeamPlayers, PlayerBasicInfo } from './collectors/team-players';
import { collectPlayerProfile } from './collectors/player-profile';
import { collectPlayerSeasonStats } from './collectors/player-season-stats';
import { delay } from './utils/delay';
import { logger } from './utils/logger';
import { Page } from 'playwright';

// ── CLI Argument Parsing ──

interface CliArgs {
  command: string;
  league?: string;
  teamId?: number;
  headed: boolean;
  debug: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    command: args[0] || 'all',
    headed: false,
    debug: false,
  };

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--league':
        result.league = args[++i];
        break;
      case '--team':
        result.teamId = parseInt(args[++i], 10);
        break;
      case '--headed':
        result.headed = true;
        break;
      case '--debug':
        result.debug = true;
        break;
    }
  }

  return result;
}

// ── Season & Standings Discovery ──

interface TeamInfo {
  teamId: number;
  slug: string;
  name: string;
}

interface SeasonInfo {
  seasonId: number;
  seasonName: string;
}

/**
 * Discover season + teams using in-browser fetch.
 * First gets the season list, then fetches standings for the current season.
 */
async function discoverSeasonAndTeams(
  page: Page,
  league: LeagueConfig
): Promise<{ season: SeasonInfo; teams: TeamInfo[] }> {
  logger.info(`Discovering season & teams for ${league.name}...`);

  // Navigate to any SofaScore page first to establish browser session
  const teamPageUrl = `https://www.sofascore.com/football/tournament/${league.slug}/${league.uniqueTournamentId}`;

  // Listen for standings APIs that fire on page load
  const standingsCapture = captureApiResponse(page, 'standings/total', 20000).catch(() => null);
  const seasonsCapture = captureApiResponse(page, 'standings/seasons', 20000).catch(() => null);

  await page.goto(teamPageUrl, { waitUntil: 'load', timeout: 30000 });
  await delay(5000);

  // Try to get season from intercepted API first
  let season: SeasonInfo | undefined;
  const seasonsData = await seasonsCapture;
  if (seasonsData?.uniqueTournamentSeasons?.[0]) {
    const uts = seasonsData.uniqueTournamentSeasons[0];
    const s = uts.seasons?.[0];
    if (s) {
      season = { seasonId: s.id, seasonName: s.name || `${s.year}` };
    }
  }

  // Fallback: use in-browser fetch for seasons
  if (!season) {
    const seasonsResult = await page.evaluate(async (utId) => {
      try {
        const res = await fetch(`https://www.sofascore.com/api/v1/unique-tournament/${utId}/seasons`);
        return res.ok ? await res.json() : null;
      } catch { return null; }
    }, league.uniqueTournamentId);

    if (seasonsResult?.seasons?.[0]) {
      const s = seasonsResult.seasons[0];
      season = { seasonId: s.id, seasonName: s.name || `${s.year}` };
    }
  }

  if (!season) {
    throw new Error(`Could not discover season for ${league.name}`);
  }
  logger.info(`Current season: ${season.seasonName} (ID: ${season.seasonId})`);

  // Try to get teams from intercepted standings
  let teams: TeamInfo[] = [];
  const standingsData = await standingsCapture;
  if (standingsData?.standings) {
    teams = extractTeamsFromStandings(standingsData);
  }

  // Fallback: use in-browser fetch for standings
  if (teams.length === 0) {
    const standingsResult = await page.evaluate(async ({ utId, sId }) => {
      try {
        const res = await fetch(`https://www.sofascore.com/api/v1/unique-tournament/${utId}/season/${sId}/standings/total`);
        return res.ok ? await res.json() : null;
      } catch { return null; }
    }, { utId: league.uniqueTournamentId, sId: season.seasonId });

    if (standingsResult?.standings) {
      teams = extractTeamsFromStandings(standingsResult);
    }
  }

  logger.info(`Found ${teams.length} teams in ${league.name}`);
  return { season, teams };
}

function extractTeamsFromStandings(data: any): TeamInfo[] {
  const teams: TeamInfo[] = [];
  for (const group of data.standings || []) {
    for (const row of group.rows || []) {
      const team = row.team;
      if (team) {
        teams.push({
          teamId: team.id,
          slug: team.slug || team.name.toLowerCase().replace(/\s+/g, '-'),
          name: team.name,
        });
      }
    }
  }
  return teams;
}

// ── Pipeline Functions ──

async function runTeamStats(
  page: Page,
  teams: TeamInfo[],
  league: LeagueConfig,
  season: SeasonInfo
): Promise<void> {
  for (const team of teams) {
    try {
      await collectTeamStatistics(page, team, league.uniqueTournamentId, league.name, season);
      await delay(ENV.PAGE_DELAY_MS);
    } catch (err) {
      logger.error(`Failed team stats for ${team.name}: ${(err as Error).message}`);
    }
  }
}

async function runTeamPlayers(
  page: Page,
  teams: TeamInfo[]
): Promise<Map<number, PlayerBasicInfo[]>> {
  const allPlayers = new Map<number, PlayerBasicInfo[]>();

  for (const team of teams) {
    try {
      const players = await collectTeamPlayers(page, team);
      allPlayers.set(team.teamId, players);
      await delay(ENV.PAGE_DELAY_MS);
    } catch (err) {
      logger.error(`Failed team players for ${team.name}: ${(err as Error).message}`);
    }
  }

  return allPlayers;
}

async function runPlayerProfiles(
  page: Page,
  playersByTeam: Map<number, PlayerBasicInfo[]>
): Promise<number> {
  const seen = new Set<number>();
  let count = 0;

  for (const [, players] of playersByTeam) {
    for (const player of players) {
      if (seen.has(player.playerId)) continue;
      seen.add(player.playerId);

      try {
        await collectPlayerProfile(page, player);
        count++;
        logger.info(`[Profile ${count}/${seen.size}] ${player.name} done. Waiting ${ENV.PLAYER_DELAY_MS / 1000}s...`);
        await delay(ENV.PLAYER_DELAY_MS);
      } catch (err) {
        logger.error(`Failed player profile for ${player.name}: ${(err as Error).message}`);
      }
    }
  }

  return count;
}

async function runPlayerSeasonStats(
  page: Page,
  playersByTeam: Map<number, PlayerBasicInfo[]>,
  league: LeagueConfig,
  season: SeasonInfo
): Promise<number> {
  const seen = new Set<number>();
  let count = 0;

  for (const [, players] of playersByTeam) {
    for (const player of players) {
      if (seen.has(player.playerId)) continue;
      seen.add(player.playerId);

      try {
        await collectPlayerSeasonStats(page, player, league.uniqueTournamentId, league.name, season);
        count++;
        logger.info(`[Stats ${count}/${seen.size}] ${player.name} done. Waiting ${ENV.PLAYER_DELAY_MS / 1000}s...`);
        await delay(ENV.PLAYER_DELAY_MS);
      } catch (err) {
        logger.error(`Failed player season stats for ${player.name}: ${(err as Error).message}`);
      }
    }
  }

  return count;
}

// ── Main Pipeline ──

async function runPipeline(args: CliArgs): Promise<void> {
  validateEnv();

  const context = await launchBrowser(args.headed);
  const page = await context.newPage();

  // Determine which leagues to process
  let leagues: LeagueConfig[];
  if (args.league) {
    const found = findLeague(args.league);
    if (!found) {
      logger.error(`League not found: ${args.league}. Available: ${LEAGUES.map((l) => l.name).join(', ')}`);
      process.exit(1);
    }
    leagues = [found];
  } else {
    leagues = LEAGUES;
  }

  const stats = { teams: 0, players: 0, profiles: 0, seasonStats: 0 };

  try {
    for (const league of leagues) {
      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`Processing: ${league.name}`);
      logger.info(`${'='.repeat(60)}`);

      // Step 1: Discover season + teams
      const { season, teams: allTeams } = await discoverSeasonAndTeams(page, league);
      await delay(ENV.PAGE_DELAY_MS);

      // Filter to single team if specified
      let teams = allTeams;
      if (args.teamId) {
        teams = allTeams.filter((t) => t.teamId === args.teamId);
        if (teams.length === 0) {
          logger.warn(`Team ID ${args.teamId} not found in ${league.name}`);
          continue;
        }
      }

      stats.teams += teams.length;

      // Step 2: Execute requested command
      if (args.command === 'all' || args.command === 'team-stats') {
        await runTeamStats(page, teams, league, season);
      }

      let playersByTeam: Map<number, PlayerBasicInfo[]> = new Map();

      if (
        args.command === 'all' ||
        args.command === 'team-players' ||
        args.command === 'player-profiles' ||
        args.command === 'player-stats'
      ) {
        playersByTeam = await runTeamPlayers(page, teams);
        for (const [, players] of playersByTeam) {
          stats.players += players.length;
        }
      }

      if (args.command === 'all' || args.command === 'player-profiles') {
        stats.profiles += await runPlayerProfiles(page, playersByTeam);
      }

      if (args.command === 'all' || args.command === 'player-stats') {
        stats.seasonStats += await runPlayerSeasonStats(page, playersByTeam, league, season);
      }
    }
  } finally {
    await page.close();
    await closeBrowser();
  }

  // Print summary
  logger.info(`\n${'='.repeat(60)}`);
  logger.info('Collection Complete!');
  logger.info(`${'='.repeat(60)}`);
  logger.info(`Teams processed: ${stats.teams}`);
  logger.info(`Players found: ${stats.players}`);
  logger.info(`Profiles collected: ${stats.profiles}`);
  logger.info(`Season stats collected: ${stats.seasonStats}`);
}

// ── Entry Point ──

const args = parseArgs();

if (args.debug) {
  process.env.LOG_LEVEL = 'debug';
}

const validCommands = ['all', 'team-stats', 'team-players', 'player-profiles', 'player-stats'];
if (!validCommands.includes(args.command)) {
  console.log(`
Usage: npx ts-node src/cli.ts <command> [options]

Commands:
  all               Run full pipeline (all 4 collectors)
  team-stats        Collect team statistics only
  team-players      Collect team players only
  player-profiles   Collect player profiles only
  player-stats      Collect player season stats only

Options:
  --league "Name"   Filter to a specific league
  --team <id>       Filter to a specific team ID
  --headed          Show browser window (non-headless)
  --debug           Enable debug logging

Examples:
  npx ts-node src/cli.ts all
  npx ts-node src/cli.ts all --league "Premier League"
  npx ts-node src/cli.ts team-stats --league "Premier League" --team 35
  npx ts-node src/cli.ts all --league "Premier League" --headed --debug
  `);
  process.exit(0);
}

runPipeline(args).catch((err) => {
  logger.error(`Pipeline failed: ${(err as Error).message}`);
  process.exit(1);
});
