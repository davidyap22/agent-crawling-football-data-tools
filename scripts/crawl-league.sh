#!/bin/bash
# Crawl a single league
# Usage:
#   bash scripts/crawl-league.sh "Premier League"
#   bash scripts/crawl-league.sh "La Liga" --headed --debug
#   bash scripts/crawl-league.sh "Bundesliga"
#   bash scripts/crawl-league.sh "Serie A"
#   bash scripts/crawl-league.sh "Ligue 1"
#   bash scripts/crawl-league.sh "Champions League"

cd "$(dirname "$0")/.."

if [ -z "$1" ]; then
  echo "Usage: bash scripts/crawl-league.sh <league-name> [--headed] [--debug]"
  echo ""
  echo "Available leagues:"
  echo "  \"Premier League\"     (20 teams)"
  echo "  \"La Liga\"            (20 teams)"
  echo "  \"Bundesliga\"         (18 teams)"
  echo "  \"Serie A\"            (20 teams)"
  echo "  \"Ligue 1\"            (18 teams)"
  echo "  \"Champions League\"   (36 teams)"
  exit 1
fi

LEAGUE="$1"
shift

echo "======================================"
echo "  SofaScore Crawl: $LEAGUE"
echo "======================================"
echo "Starting at: $(date)"
echo ""

npx ts-node src/cli.ts all --league "$LEAGUE" "$@" 2>&1 | tee logs/crawl-$(echo "$LEAGUE" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')-$(date +%Y%m%d-%H%M%S).log

echo ""
echo "Finished at: $(date)"
