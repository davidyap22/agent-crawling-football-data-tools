# SofaScore Data Collector - Skills Guide

## Overview

Browser-based data collector using **Playwright** to intercept SofaScore API responses.
Opens Chrome → navigates to SofaScore pages → captures network API JSON → writes to Supabase.

**Target database**: Primary Supabase (`wykjlhbsxparltxazxmk`)

---

## Quick Start

```bash
# 1. Install dependencies
npm install
npx playwright install chromium

# 2. Configure environment
cp .env.example .env
# Edit .env with your Supabase credentials

# 3. Create database tables
# Run sql/create-tables.sql in Supabase SQL Editor

# 4. Test with one team first
bash scripts/crawl-team.sh 35 "Premier League" --headed --debug
```

---

## Terminal Commands

### Shell Scripts (Recommended)

```bash
# Crawl all 5 major leagues (~96 teams, ~2400 players)
bash scripts/crawl-5leagues.sh

# Crawl all 6 leagues (5 + Champions League)
bash scripts/crawl-all.sh

# Crawl a single league
bash scripts/crawl-league.sh "Premier League"
bash scripts/crawl-league.sh "La Liga"
bash scripts/crawl-league.sh "Bundesliga"
bash scripts/crawl-league.sh "Serie A"
bash scripts/crawl-league.sh "Ligue 1"
bash scripts/crawl-league.sh "Champions League"

# Crawl a single team
bash scripts/crawl-team.sh 35                           # Man Utd
bash scripts/crawl-team.sh 2829 "La Liga"               # Real Madrid
bash scripts/crawl-team.sh 2672 "Bundesliga"             # Bayern Munich

# With options
bash scripts/crawl-league.sh "Premier League" --headed   # Show browser
bash scripts/crawl-league.sh "Premier League" --debug    # Verbose logs
```

### Direct CLI Commands

```bash
# Full pipeline
npx ts-node src/cli.ts all
npx ts-node src/cli.ts all --league "Premier League"
npx ts-node src/cli.ts all --league "La Liga" --headed --debug
npx ts-node src/cli.ts all --team 35

# Individual collectors
npx ts-node src/cli.ts team-stats --league "Premier League"
npx ts-node src/cli.ts team-players --league "Premier League"
npx ts-node src/cli.ts player-profiles --league "Premier League"
npx ts-node src/cli.ts player-stats --league "Premier League"
```

### npm Scripts

```bash
npm run collect:all                   # All leagues, all collectors
npm run collect:team-stats            # Team statistics only
npm run collect:team-players          # Team rosters only
npm run collect:player-profiles       # Player profiles only
npm run collect:player-stats          # Player season stats only
```

---

## League Configuration

| League | Tournament ID | Teams | Slug |
|--------|:---:|:---:|------|
| Premier League | 17 | 20 | `premier-league` |
| La Liga | 8 | 20 | `laliga` |
| Bundesliga | 35 | 18 | `bundesliga` |
| Serie A | 23 | 20 | `serie-a` |
| Ligue 1 | 34 | 18 | `ligue-1` |
| Champions League | 7 | 36 | `uefa-champions-league` |

**Season IDs are auto-discovered** — no need to hardcode them.

---

## 4 Data Collectors

### 1. Team Statistics (`sofascore_team_statistics`)
- Goals, shots, passes, possession, tackles, fouls, cards
- W/D/L record per season
- Source: `/api/v1/team/{id}/unique-tournament/{utId}/season/{sId}/statistics/overall`

### 2. Team Players (`sofascore_team_players`)
- Player roster with position, number, height, foot, nationality
- Market value, contract info, injury status
- Source: DOM links from team page

### 3. Player Profiles (`sofascore_player_profiles`)
- Bio: name, position, height, country, team, shirt number
- Attribute ratings: attacking, technical, tactical, defending, creativity
- Strengths & weaknesses (text)
- National team stats
- Transfer history
- Source: `__NEXT_DATA__` SSR + 3 APIs + DOM

### 4. Player Season Stats (`sofascore_player_season_stats`)
- 112 fields from SofaScore API
- Categories: Matches, Attacking, Passing, Defending, Other, Cards, Rating
- Source: `/api/v1/player/{id}/unique-tournament/{utId}/season/{sId}/statistics/overall`

---

## Database Tables

```
sofascore_team_statistics    → UNIQUE(team_id, tournament_id, season_id)
sofascore_team_players       → UNIQUE(player_id, team_id)
sofascore_player_profiles    → UNIQUE(player_id)
sofascore_player_season_stats → UNIQUE(player_id, tournament_id, season_id)
```

All tables have `raw_data JSONB` for full API response + `created_at` / `updated_at` timestamps.

---

## Environment Variables (.env)

```bash
# Required
SUPABASE_URL=https://wykjlhbsxparltxazxmk.supabase.co
SUPABASE_SERVICE_KEY=your-service-key-here

# Browser (optional)
HEADLESS=true              # false = show browser window
PAGE_DELAY_MS=3000         # Delay between team pages (ms)
TAB_DELAY_MS=2000          # Delay after tab clicks (ms)
PLAYER_DELAY_MS=120000     # Delay between players (ms), default 2 min to avoid detection

# Retry (optional)
MAX_RETRIES=2              # Retry count per operation
RETRY_DELAY_MS=5000        # Delay between retries (ms)

# Logging (optional)
LOG_LEVEL=info             # debug | info | warn | error
```

---

## Crawl Pipeline Flow

```
For each league:
  1. Navigate to tournament page → discover current season + all teams
  2. For each team:
     a. Team page → Statistics tab → team stats → DB
     b. Team page → Players tab → player list → DB
  3. For each player (deduplicated):
     a. Player page → profile + attributes + transfers → DB
     b. In-browser fetch → season stats (112 fields) → DB
```

---

## Timing Estimates

Default `PLAYER_DELAY_MS=120000` (2 min between each player to avoid detection).

| Scope | Teams | Players | Est. Time |
|-------|:-----:|:-------:|:---------:|
| 1 team | 1 | ~25 | ~2 hours |
| Premier League | 20 | ~500 | ~1.5 days |
| 5 leagues | 96 | ~2400 | ~7 days |

Recommend: run 1 league per day with `nohup`.

---

## Error Handling

- Each team/player is independent — one failure doesn't stop the pipeline
- All upserts are idempotent — safe to re-run anytime
- Automatic retry with configurable attempts and delay
- Logs go to stderr, data to stdout
- Shell scripts save logs to `logs/` directory

---

## Tips

1. **First run**: Test with one team first to verify Supabase connection
   ```bash
   bash scripts/crawl-team.sh 35 "Premier League" --headed --debug
   ```

2. **Adjust speed**: Change PLAYER_DELAY_MS in .env (default 120000 = 2 min, safe from detection)

3. **Re-run safe**: All operations use UPSERT — running again just updates existing data

4. **Debug issues**: Use `--headed --debug` to see browser + verbose logs

5. **Run per league**: Start 1 league per day with `nohup bash scripts/crawl-league.sh "Premier League" > logs/epl.log 2>&1 &`
