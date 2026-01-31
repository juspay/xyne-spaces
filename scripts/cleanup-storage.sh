#!/bin/bash

# Cleanup script for Docker/Podman storage

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}🧹 Cleaning up container storage...${NC}"

# Detect container runtime
if command -v podman &> /dev/null; then
    echo -e "${GREEN}Using Podman${NC}"

    # Stop all containers
    echo -e "${YELLOW}Stopping all containers...${NC}"
    podman stop -a 2>/dev/null || true

    # Remove all containers
    echo -e "${YELLOW}Removing all containers...${NC}"
    podman rm -a 2>/dev/null || true

    # Remove all images
    echo -e "${YELLOW}Removing all images...${NC}"
    podman rmi -a 2>/dev/null || true

    # Prune system
    echo -e "${YELLOW}Pruning system...${NC}"
    podman system prune -a -f --volumes

    # Reset Podman machine (macOS/Windows)
    if podman machine list &> /dev/null; then
        echo -e "${YELLOW}Resetting Podman machine...${NC}"
        podman machine stop 2>/dev/null || true
        podman machine rm -f 2>/dev/null || true
        echo -e "${YELLOW}Creating new Podman machine with more disk space...${NC}"
        podman machine init --disk-size 100
        podman machine start
    fi

elif command -v docker &> /dev/null; then
    echo -e "${GREEN}Using Docker${NC}"

    # Stop all containers
    echo -e "${YELLOW}Stopping all containers...${NC}"
    docker stop $(docker ps -aq) 2>/dev/null || true

    # Remove all containers
    echo -e "${YELLOW}Removing all containers...${NC}"
    docker rm $(docker ps -aq) 2>/dev/null || true

    # Remove all images
    echo -e "${YELLOW}Removing all images...${NC}"
    docker rmi $(docker images -q) 2>/dev/null || true

    # Prune system
    echo -e "${YELLOW}Pruning system...${NC}"
    docker system prune -a -f --volumes

else
    echo -e "${RED}Neither Docker nor Podman found${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ Cleanup complete!${NC}"
echo -e "${BLUE}Storage freed up. You can now run ./dev-start.sh${NC}"
