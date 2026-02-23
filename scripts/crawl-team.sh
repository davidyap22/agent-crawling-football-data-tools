#!/bin/bash
# Crawl a single team by ID
# Usage:
#   bash scripts/crawl-team.sh 35                           # Man Utd (auto-detect league)
#   bash scripts/crawl-team.sh 35 "Premier League"          # Man Utd with league specified
#   bash scripts/crawl-team.sh 35 "Premier League" --headed  # With browser visible

cd "$(dirname "$0")/.."

if [ -z "$1" ]; then
  echo "Usage: bash scripts/crawl-team.sh <team-id> [league-name] [--headed] [--debug]"
  echo ""
  echo "Common team IDs (Premier League):"
  echo "  35   Manchester United"
  echo "  17   Manchester City"
  echo "  40   Liverpool"
  echo "  42   Arsenal"
  echo "  33   Chelsea"
  echo "  30   Tottenham"
  echo ""
  echo "Common team IDs (La Liga):"
  echo "  2829 Real Madrid"
  echo "  2817 Barcelona"
  echo "  2836 Atletico Madrid"
  echo ""
  echo "Common team IDs (Bundesliga):"
  echo "  2672 Bayern Munich"
  echo "  2673 Borussia Dortmund"
  echo ""
  echo "Common team IDs (Serie A):"
  echo "  2697 Juventus"
  echo "  2702 Inter Milan"
  echo "  2714 AC Milan"
  echo ""
  echo "Common team IDs (Ligue 1):"
  echo "  1644 PSG"
  exit 1
fi

TEAM_ID="$1"
shift

LEAGUE_ARG=""
if [ -n "$1" ] && [[ ! "$1" == --* ]]; then
  LEAGUE_ARG="--league \"$1\""
  shift
fi

echo "======================================"
echo "  SofaScore Crawl: Team #$TEAM_ID"
echo "======================================"
echo "Starting at: $(date)"
echo ""

eval npx ts-node src/cli.ts all --team "$TEAM_ID" $LEAGUE_ARG "$@"

echo ""
echo "Finished at: $(date)"
