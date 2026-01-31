#!/usr/bin/env bash
# Comprehensive cleanup script for Nix dev environment
# Cleans ports and database volumes only
#
# This is the Nix equivalent of:
#   - docker-compose down -v (stops containers and removes volumes)
#   - npm run cleanup (from package.json - removes Docker/Podman storage)
#
# Use this when:
#   - Database migrations break
#   - You need a fresh database
#   - Switching branches with schema changes

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🧹 Starting cleanup...${NC}"
echo ""

# 1. Clean up ports and processes
echo -e "${YELLOW}1. Cleaning up ports and processes...${NC}"
COMPOSE_PIDS=$(ps aux | grep process-compose | grep -v grep | awk '{print $2}' || true)
if [ -n "$COMPOSE_PIDS" ]; then
  echo "   Killing process-compose sessions..."
  echo "$COMPOSE_PIDS" | xargs kill -9 2>/dev/null || true
fi

PORTS=(5433 6379 7880 4848 4849 8080 4443 8001)
for port in "${PORTS[@]}"; do
  PIDS=$(lsof -ti:$port 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "   Freeing port $port..."
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
  fi
done
echo -e "${GREEN}   ✓ Ports and processes cleaned${NC}"
echo ""

# 2. Clean up Nix data directories (equivalent to Docker volumes)
echo -e "${YELLOW}2. Cleaning up database volumes...${NC}"
if [ -d "data" ]; then
  echo "   Removing data/ directory (PostgreSQL, Redis, Zero Cache data)..."
  rm -rf data/
  echo -e "${GREEN}   ✓ data/ removed (databases wiped)${NC}"
else
  echo "   No data/ directory found"
fi

if [ -d ".logs" ]; then
  echo "   Removing .logs/ directory..."
  rm -rf .logs/
  echo -e "${GREEN}   ✓ .logs/ removed${NC}"
else
  echo "   No .logs/ directory found"
fi

if [ -d ".nix-cache" ]; then
  echo "   Removing .nix-cache/ directory (downloaded binaries)..."
  rm -rf .nix-cache/
  echo -e "${GREEN}   ✓ .nix-cache/ removed${NC}"
else
  echo "   No .nix-cache/ directory found"
fi

if [ -d "backend/python-agent/.venv" ]; then
  echo "   Removing Python virtual environment..."
  rm -rf backend/python-agent/.venv
  echo -e "${GREEN}   ✓ Python .venv/ removed${NC}"
else
  echo "   No Python .venv/ found"
fi
echo ""
echo -e "${YELLOW}⚠️  This is equivalent to 'docker-compose down -v' (volumes removed)${NC}"
echo ""

# Summary
echo -e "${GREEN}✅ Cleanup complete!${NC}"
echo ""
echo -e "${BLUE}What was cleaned:${NC}"
echo "  ✓ All service processes and ports"
echo "  ✓ All database volumes (PostgreSQL, Redis, Zero Cache)"
echo "  ✓ All service data (YSweet, Fake GCS)"
echo ""
echo -e "${YELLOW}⚠️  All local database data has been wiped!${NC}"
echo -e "${BLUE}Note: node_modules and caches were preserved${NC}"
echo ""
echo -e "${BLUE}Next steps for fresh start:${NC}"
echo "  1. Run: nix run .#xyne-space-services"
echo "  2. Wait for services to start (~10 seconds)"
echo "  3. Run: cd backend && npm run dev (in another terminal)"
echo "  4. Run: just assign-admin YOUR_EMAIL"
echo "  5. Run: cd dashboard && npm run dev (in another terminal)"
echo ""

