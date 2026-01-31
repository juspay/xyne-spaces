#!/usr/bin/env bash
# Database setup script for Nix dev environment
# This replicates the database setup from scripts/start-services.sh

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Only run if backend directory exists and has node_modules
if [ ! -d "backend/node_modules" ]; then
  echo -e "${YELLOW}⚠️  Backend dependencies not installed. Skipping database setup.${NC}"
  echo -e "${YELLOW}   Run: cd backend && npm install${NC}"
  exit 0
fi

echo -e "${BLUE}🔄 Checking database setup...${NC}"

cd backend

# Check if users table exists (Prisma creates lowercase table names)
USER_COUNT=$(psql -h 127.0.0.1 -p 5433 -U xyne -d xyne_dev_db -t -c "SELECT COUNT(*) FROM users;" 2>&1 || echo "ERROR")
USER_COUNT=$(echo "$USER_COUNT" | xargs)

if [[ "$USER_COUNT" == *"ERROR"* ]] || [[ "$USER_COUNT" == *"does not exist"* ]] || [ -z "$USER_COUNT" ]; then
  # First run - User table doesn't exist, need to set up everything
  echo -e "${YELLOW}⚠️  User table doesn't exist. Setting up database from scratch...${NC}"
  
  # Drop and recreate database for clean setup
  echo -e "${BLUE}Dropping and recreating database...${NC}"
  psql -h 127.0.0.1 -p 5433 -U xyne -d postgres -c "DROP DATABASE IF EXISTS xyne_dev_db;" 2>/dev/null || true
  psql -h 127.0.0.1 -p 5433 -U xyne -d postgres -c "CREATE DATABASE xyne_dev_db;" 2>/dev/null || true
  
  # Push schema with force-reset (first time setup - ensures tables are created)
  echo -e "${BLUE}Creating database schema...${NC}"
  npx dotenv -e .env.local -- npx prisma db push --force-reset --accept-data-loss --skip-generate
  
  # Seed ACL system
  echo -e "${BLUE}🌱 Seeding ACL system...${NC}"
  npx dotenv -e .env.local -- npx tsx scripts/seed-acl.ts
  echo -e "${GREEN}✓ ACL system seeded${NC}"
  
  # Prompt for developer user
  echo ""
  echo -e "${YELLOW}📧 Create a developer user? (optional, press Enter to skip)${NC}"
  read -p "Email: " USER_EMAIL
  
  if [ -n "$USER_EMAIL" ]; then
    echo -e "${BLUE}Creating developer user for ${USER_EMAIL}...${NC}"
    npx dotenv -e .env.local -- npx tsx scripts/assign-user-group.ts "$USER_EMAIL"
    echo -e "${GREEN}✓ Developer user created${NC}"
  else
    echo -e "${YELLOW}⚠️  Skipping user creation${NC}"
  fi
else
  # User table exists - just sync schema changes without dropping data
  echo -e "${BLUE}Syncing database schema...${NC}"
  npx dotenv -e .env.local -- npx prisma db push
  echo -e "${GREEN}✓ Database schema is up to date${NC}"
fi

echo -e "${GREEN}✓ Database ready${NC}"
cd ..
