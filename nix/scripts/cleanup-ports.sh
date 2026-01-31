#!/usr/bin/env bash
# Cleanup script for Nix dev environment
# Kills all process-compose sessions and services on development ports

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}🧹 Cleaning up development services...${NC}"

# Kill all process-compose instances
COMPOSE_PIDS=$(ps aux | grep process-compose | grep -v grep | awk '{print $2}' || true)
if [ -n "$COMPOSE_PIDS" ]; then
  echo -e "${YELLOW}Killing process-compose sessions...${NC}"
  echo "$COMPOSE_PIDS" | xargs kill -9 2>/dev/null || true
  echo -e "${GREEN}✓ Process-compose sessions killed${NC}"
fi

# Kill processes on specific ports
PORTS=(5433 6379 7880 4848 4849 8080 4443 8001)
for port in "${PORTS[@]}"; do
  PIDS=$(lsof -ti:$port 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo -e "${YELLOW}Killing processes on port $port...${NC}"
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
    echo -e "${GREEN}✓ Port $port freed${NC}"
  fi
done

sleep 1

# Verify all ports are free
echo ""
echo -e "${BLUE}Verifying ports are free...${NC}"
STILL_USED=$(lsof -i :5433 -i :6379 -i :7880 -i :4848 -i :4849 -i :8080 -i :4443 -i :8001 2>/dev/null | grep LISTEN || true)

if [ -z "$STILL_USED" ]; then
  echo -e "${GREEN}✓ All development ports are free${NC}"
else
  echo -e "${YELLOW}⚠️  Some ports are still in use:${NC}"
  echo "$STILL_USED"
fi

echo ""
echo -e "${GREEN}✅ Cleanup complete!${NC}"
