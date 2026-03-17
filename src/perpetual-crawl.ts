/**
 * 永动机: 自动定时采集球队统计 + 球员数据
 *
 * - crawl-team-stats --all --force  → 每天 1 次
 * - crawl-team --all --update       → 每 3 天 1 次
 *
 * Usage:
 *   npx ts-node src/perpetual-crawl.ts
 *   npx ts-node src/perpetual-crawl.ts --debug
 */
import { execSync, spawn } from 'child_process';

const DEBUG = process.argv.includes('--debug');

function log(msg: string) {
  const time = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[${time}] ${msg}`);
}

function runScript(command: string, label: string): Promise<number> {
  return new Promise((resolve) => {
    log(`▶ START: ${label}`);
    log(`  Command: ${command}`);

    const child = spawn('npx', ['ts-node', ...command.split(' ')], {
      stdio: 'inherit',
      shell: true,
    });

    child.on('close', (code) => {
      log(`■ DONE: ${label} (exit code: ${code})`);
      resolve(code ?? 1);
    });

    child.on('error', (err) => {
      log(`✗ ERROR: ${label} — ${err.message}`);
      resolve(1);
    });
  });
}

function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function main() {
  log('========================================');
  log('永动机 Perpetual Crawl — Started');
  log('========================================');
  log('Schedule:');
  log('  - Team Stats (--force):  every 24 hours');
  log('  - Player Update:         every 72 hours');
  log('');

  const TEAM_STATS_INTERVAL = 24 * 60 * 60 * 1000;   // 24 hours
  const PLAYER_UPDATE_INTERVAL = 72 * 60 * 60 * 1000; // 72 hours
  const CHECK_INTERVAL = 60 * 1000;                    // check every 1 minute

  let lastTeamStats = 0;
  let lastPlayerUpdate = 0;
  let cycle = 0;

  // Run team stats immediately on start
  while (true) {
    const now = Date.now();

    // Check: team stats (every 24h)
    if (now - lastTeamStats >= TEAM_STATS_INTERVAL) {
      cycle++;
      log(`\n===== Cycle #${cycle} =====`);

      const debugFlag = DEBUG ? ' --debug' : '';
      await runScript(`src/crawl-team-stats.ts --all --force${debugFlag}`, 'Team Stats (all leagues)');
      lastTeamStats = Date.now();

      const nextTeamStats = new Date(lastTeamStats + TEAM_STATS_INTERVAL);
      log(`Next team stats: ${nextTeamStats.toISOString().slice(0, 19).replace('T', ' ')}`);
    }

    // Check: player update (every 72h)
    if (now - lastPlayerUpdate >= PLAYER_UPDATE_INTERVAL) {
      const debugFlag = DEBUG ? ' --debug' : '';
      await runScript(`src/crawl-team.ts --all --update${debugFlag}`, 'Player Update (all leagues)');
      lastPlayerUpdate = Date.now();

      const nextPlayerUpdate = new Date(lastPlayerUpdate + PLAYER_UPDATE_INTERVAL);
      log(`Next player update: ${nextPlayerUpdate.toISOString().slice(0, 19).replace('T', ' ')}`);
    }

    // Sleep until next check
    const nextTeamIn = TEAM_STATS_INTERVAL - (Date.now() - lastTeamStats);
    const nextPlayerIn = PLAYER_UPDATE_INTERVAL - (Date.now() - lastPlayerUpdate);
    const nextEventIn = Math.min(nextTeamIn, nextPlayerIn);

    log(`Sleeping... next event in ${formatDuration(nextEventIn)}`);
    await new Promise(r => setTimeout(r, Math.min(nextEventIn, CHECK_INTERVAL)));
  }
}

main().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
