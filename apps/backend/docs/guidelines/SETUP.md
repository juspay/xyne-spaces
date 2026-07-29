# Setup Guide

## Prerequisites

1. **Install OrbStack**
   - Download from [orbstack.dev](https://orbstack.dev/)
   - Run the OrbStack machine - this injects Docker commands into your local environment

2. **Verify Docker**
   ```bash
   docker --version
   # Ensure it's pointing to OrbStack
   ```

## Installation

```bash
# 1. Install dependencies (from project root)
cd /path/to/xyne-spaces3
npm install

# 2. Start services (Docker containers)
npm run services
# Enter your email when prompted

# 3. Start backend
cd backend
npm run dev

# 4. (Optional) Start worker in separate terminal
cd backend
npm run dev:worker
```

## Verification

| Service | Check |
|---------|-------|
| Backend | `http://localhost:3000/health` |
| Docker | `docker ps` shows running containers |

## Common Issues

| Issue | Solution |
|-------|----------|
| Docker not found | Ensure OrbStack is running |
| npm install fails | Delete `node_modules` and retry |
| Services won't start | Check Docker is pointing to OrbStack |
