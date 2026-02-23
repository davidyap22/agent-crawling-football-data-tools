#!/bin/bash
# Crawl 5 major domestic leagues (no Champions League)
# Usage: bash scripts/crawl-5leagues.sh [--headed] [--debug]
#
# Leagues: Premier League, La Liga, Bundesliga, Serie A, Ligue 1
# ~96 teams, ~2400+ players
# Estimated time: 2-4 hours (headless)

cd "$(dirname "$0")/.."
mkdir -p logs

echo "======================================"
echo "  SofaScore Crawl - 5 Major Leagues"
echo "======================================"
echo "Starting at: $(date)"
echo ""

LOGFILE="logs/crawl-5leagues-$(date +%Y%m%d-%H%M%S).log"

LEAGUES=("Premier League" "La Liga" "Bundesliga" "Serie A" "Ligue 1")

for LEAGUE in "${LEAGUES[@]}"; do
  echo ""
  echo "============================================"
  echo "  Starting: $LEAGUE"
  echo "  Time: $(date)"
  echo "============================================"
  echo ""

  npx ts-node src/cli.ts all --league "$LEAGUE" "$@"

  if [ $? -ne 0 ]; then
    echo "WARNING: $LEAGUE crawl had errors, continuing..."
  fi

  echo "$LEAGUE completed at $(date)"
  echo ""
  # Brief pause between leagues
  sleep 5
done

echo ""
echo "======================================"
echo "  All 5 leagues completed!"
echo "  Finished at: $(date)"
echo "======================================"
