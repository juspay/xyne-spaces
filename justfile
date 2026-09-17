# Xyne Spaces Development Justfile
# Run commands with: just <command>

# Default recipe to display help
default:
    @just --list

# Start all services using Nix
[group('nix')]
services:
    nix run .#xyne-space-services

# Cleanup ports and database volumes (like docker-compose down -v)
[group('nix')]
cleanup:
    nix run .#cleanup

# Clean only ports (lightweight cleanup)
[group('nix')]
cleanup-ports:
    ./nix/scripts/cleanup-ports.sh

# Start backend development server
[group('development')]
backend: prepare
    cd apps/backend && pnpm run dev

# Install dependencies, build workspace libraries, and generate both Prisma clients
[group('development')]
prepare:
    pnpm run env:setup
    pnpm install
    pnpm run build:shared
    pnpm run secrets --livekit
    just prisma-generate

# Start dashboard development server
[group('development')]
dashboard: prepare
    cd apps/dashboard && pnpm run dev

# Run database migrations
migrate:
    cd apps/backend && pnpm exec dotenv -e .env.local -- pnpm exec prisma db push
    cd apps/backend && pnpm exec dotenv -e .env.local -- pnpm exec prisma db push --schema prisma-common/schema.prisma

# Generate Prisma client
prisma-generate:
    cd apps/backend && pnpm exec prisma generate
    cd apps/backend && pnpm exec prisma generate --schema prisma-common/schema.prisma

# Deploy Zero permissions
zero-permissions:
    cd apps/backend && pnpm exec zero-deploy-permissions

# Assign user to admin group (full system access)
# Usage: just assign-admin [EMAIL]
# If EMAIL is not provided, uses DEFAULT_ADMIN_EMAIL from .env.local
assign-admin EMAIL='':
    cd apps/backend && pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/assign-admin-user.ts {{EMAIL}}

# Full fresh start (cleanup + services + backend + dashboard)
[group('nix')]
fresh-start: cleanup
    @echo "Starting services..."
    nix run .#xyne-space-services &
    @sleep 10
    @echo "Services started. Now start backend and dashboard in separate terminals:"
    @echo "  Terminal 2: just backend"
    @echo "  Terminal 3: just dashboard"

# Reset all data (remove ./data directory)
[group('nix')]
reset:
    rm -rf ./data

#one-click-setup
[group('nix')]
setup:
    chmod +x setup.sh && ./setup.sh
