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
    cd backend && npm install && npm run dev

# Start dashboard development server
dashboard:
    cd dashboard && npm install && npm run dev

# Run database migrations
migrate:
    cd backend && npx dotenv -e .env.local -- npx prisma db push

# Generate Prisma client
prisma-generate:
    cd backend && npx prisma generate

# Deploy Zero permissions
zero-permissions:
    cd backend && npx zero-deploy-permissions

# Assign user to admin group (full system access)
# Usage: just assign-admin [EMAIL]
# If EMAIL is not provided, uses DEFAULT_ADMIN_EMAIL from .env.local
assign-admin EMAIL='':
    cd backend && npx dotenv -e .env.local -- npx tsx scripts/assign-admin-user.ts {{EMAIL}}

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
