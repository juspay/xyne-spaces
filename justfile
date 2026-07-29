# Xyne Spaces Development Justfile
# Run commands with: just <command>

# Default recipe to display help
default:
    @just --list

# Start all services using Nix
services:
    nix run .#xyne-space-services

# Cleanup ports and database volumes (like docker-compose down -v)
cleanup:
    nix run .#cleanup

# Clean only ports (lightweight cleanup)
cleanup-ports:
    ./nix/scripts/cleanup-ports.sh

# Start backend development server
backend:
    cd apps/backend && pnpm install && pnpm run dev

# Start dashboard development server
dashboard:
    cd apps/dashboard && pnpm install && pnpm run dev

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
fresh-start: cleanup
    @echo "Starting services..."
    nix run .#xyne-space-services &
    @sleep 10
    @echo "Services started. Now start backend and dashboard in separate terminals:"
    @echo "  Terminal 2: just backend"
    @echo "  Terminal 3: just dashboard"

# Reset all data (remove ./data directory)
reset:
    rm -rf ./data

# Check flake
check:
    nix flake check

# Update flake inputs
update:
    nix flake update

# Show flake outputs
show:
    nix flake show --allow-import-from-derivation
#one-click-setup
setup:
    chmod +x setup.sh && ./setup.sh
