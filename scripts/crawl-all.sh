#!/bin/bash
# Crawl ALL 5 major leagues + Champions League
# Usage: bash scripts/crawl-all.sh [--headed] [--debug]
#
# This will crawl ~100 teams and ~2500+ players across 6 leagues.
# Estimated time: 3-5 hours (headless)

cd "$(dirname "$0")/.."

echo "======================================"
echo "  SofaScore Full Crawl - All Leagues"
echo "======================================"
echo ""
echo "Leagues: Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League"
echo "Starting at: $(date)"
echo ""

npx ts-node src/cli.ts all "$@" 2>&1 | tee logs/crawl-all-$(date +%Y%m%d-%H%M%S).log

echo ""
echo "Finished at: $(date)"
