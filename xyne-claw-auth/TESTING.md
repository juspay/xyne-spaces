# Testing xyne-claw locally

This guide covers how to run and manually test the `xyne-claw-auth` stack (backend on `:3003` + frontend on `:5174`) against the standard xyne-spaces dev environment (backend on `:3001`).

---

## Prerequisites

- `xyne-spaces` repo cloned and the main stack already running (`npm run dev:test` or `npm run services` + `npm run dev`)
- Node ≥ 20, npm ≥ 10
- PostgreSQL running on `:5433` (started by xyne-spaces' `npm run services`)
- Redis running on `:6379` (started by xyne-spaces' `npm run services`)

---

## 1. Database setup

Create a dedicated Postgres database for the claw-auth backend (only needed once):

```bash
psql postgresql://xyne:xyne123@localhost:5433/postgres << 'SQL'
CREATE USER claw WITH PASSWORD 'claw123';
CREATE DATABASE claw_auth_db OWNER claw;
GRANT ALL PRIVILEGES ON DATABASE claw_auth_db TO claw;
SQL
```

---

## 2. Backend — xyne-claw-auth

```bash
cd xyne-claw-auth/backend

# Copy and configure env
cp .env.example .env
```

Edit `.env` — minimum required values for local dev:

```env
AUTH_SERVICE_PORT=3003
DATABASE_URL=postgresql://claw:claw123@localhost:5433/claw_auth_db
ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000

# Point at the running xyne-spaces backend
SPACES_BACKEND_URL=http://localhost:3001

# Leave these as-is for local dev (no real OAuth needed to test UI)
XYNE_CLAW_URL=http://localhost:3002
XYNE_CLAW_S2S_KEY=dev-s2s-key
GOOGLE_CLIENT_ID=dev
GOOGLE_CLIENT_SECRET=dev
MICROSOFT_CLIENT_ID=dev
MICROSOFT_CLIENT_SECRET=dev
MICROSOFT_REDIRECT_URI=http://localhost:5174/claw/
MICROSOFT_TENANT_ID=common
FAKE_GCS_HOST=http://localhost:4443
INTERNAL_S2S_KEY=dev-internal-key
```

> ⚠️ `ENCRYPTION_KEY` must be exactly 64 hex characters (32 bytes). The all-zeros value above is fine for local testing — **never use it in production**.

```bash
# Install dependencies
npm install

# Push Prisma schema to the database
npm run db:push

# (Optional) seed default MCP servers
npm run db:seed

# Start dev server (auto-restarts on file changes)
npm run dev
```

Server starts at `http://localhost:3003`. Health check: `GET http://localhost:3003/claw/health`.

---

## 3. Frontend — xyne-claw-auth UI

```bash
cd xyne-claw-auth/frontend

# Install dependencies (usually already up to date)
npm install

# Start Vite dev server
npx vite --port 5174
# or: npm run dev  (uses vite default, may pick a different port)
```

Frontend is at **`http://localhost:5174/claw/`**.

Vite proxies automatically:

| Path | Target |
|------|--------|
| `/claw/api/auth/*` | `localhost:3001` (Spaces — strips `/claw` prefix) |
| `/api/auth/*` | `localhost:3001` (Spaces — passthrough) |
| `/claw/api/v1/*` | `localhost:3003` (claw-auth backend) |

---

## 4. Authentication in local dev

The claw-auth frontend re-uses the xyne-spaces Google OAuth session cookie. Auth flow:

1. Sign into xyne-spaces at `http://localhost:5173` (or via the test auth endpoint below).
2. The `xyne_ws_<workspaceId>_token` cookie is set on the `:3001` origin.
3. Navigate to `http://localhost:5174/claw/` — the Vite proxy forwards cookie-authenticated requests to `:3001` for session validation.

**Test auth shortcut (no real Google account needed):**

```bash
# Creates a test session and sets auth cookies
curl -s -X POST "http://localhost:3001/api/test/auth/login?isAdmin=true" \
  -H "Content-Type: application/json" \
  -c /tmp/claw-cookies.txt
```

Or in the browser console (after opening any page on `localhost:3001`):

```js
await fetch('/api/test/auth/login?isAdmin=true', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({})
});
// Then navigate to http://localhost:5174/claw/
```

---

## 5. Routes to test

| Route | What to verify |
|-------|---------------|
| `http://localhost:5174/claw/` | Redirects to `/claw/v2` (legacy) or shows sign-in page if unauthenticated |
| `http://localhost:5174/claw/v2` | v2 Agents dashboard |
| `http://localhost:5174/claw/v2/mcp` | v2 MCP Integrations (banner-style connect flow) |
| `http://localhost:5174/claw/v3` | Redirects to `/v3/mcp` |
| **`http://localhost:5174/claw/v3/mcp`** | **v3 MCP Connectors catalog (new Figma design)** |
| `http://localhost:5174/claw/v3/agents` | Agents stub (coming soon) |
| `http://localhost:5174/claw/v3/settings` | Settings stub (coming soon) |

---

## 6. Seeding test MCP connectors

The v3 MCP Connectors page shows an empty state until servers are seeded. Run the Prisma seed script:

```bash
cd xyne-claw-auth/backend
npm run db:seed
```

Or insert servers manually:

```bash
psql "postgresql://claw:claw123@localhost:5433/claw_auth_db" << 'SQL'
INSERT INTO mcp_servers (id, name, type, url, description, transport, enabled, "createdAt", "updatedAt")
VALUES
  ('s-001', 'Xyne Spaces',   'xyne-spaces',  'http://localhost:3001/mcp',       'Your Xyne Spaces workspace',          'http', true, NOW(), NOW()),
  ('s-002', 'Figma',         'figma',         'https://figma.com/mcp',           'Design and prototyping tool',         'http', true, NOW(), NOW()),
  ('s-003', 'Gmail',         'gmail',         'https://gmail.googleapis.com/mcp','Google email service',                'http', true, NOW(), NOW()),
  ('s-004', 'Bitbucket',     'bitbucket',     'https://api.bitbucket.org/mcp',   'Git code hosting',                    'http', true, NOW(), NOW()),
  ('s-005', 'Google Drive',  'google-drive',  'https://drive.googleapis.com/mcp','Cloud storage and file management',   'http', true, NOW(), NOW()),
  ('s-006', 'Slack',         'slack',         'https://slack.com/api/mcp',       'Team communication platform',         'http', true, NOW(), NOW()),
  ('s-007', 'Microsoft 365', 'microsoft',     'https://graph.microsoft.com/mcp', 'Office, Outlook, Teams and OneDrive', 'http', true, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
SQL
```

---

## 7. API smoke tests (curl)

Replace `<USER_ID>` with a valid user ID from `xyne_dev_db`:

```bash
# Get your user ID
psql "postgresql://xyne:xyne123@localhost:5433/xyne_dev_db" -At -c "SELECT id FROM users LIMIT 1;"

# Health check
curl http://localhost:3003/claw/health

# List MCP servers (all available connectors)
curl -H "x-user-id: <USER_ID>" http://localhost:3003/claw/api/v1/servers

# List current user connections
curl -H "x-user-id: <USER_ID>" "http://localhost:3003/claw/api/v1/connections/<USER_ID>"

# Auto-connect Xyne Spaces
curl -X POST -H "x-user-id: <USER_ID>" \
  "http://localhost:3003/claw/api/v1/connections/<USER_ID>/auto-connect-spaces"
```

> The `x-user-id` header is accepted by the backend's auth middleware as a dev bypass — no OAuth token needed for direct API calls.

---

## 8. TypeScript checks

```bash
# Backend
cd xyne-claw-auth/backend && npm run typecheck

# Frontend
cd xyne-claw-auth/frontend && npx tsc --noEmit --project tsconfig.json
```

---

## 9. Port reference

| Service | Port | Notes |
|---------|------|-------|
| Xyne Spaces backend | `3001` | Auth, Zero sync, main API |
| xyne-claw agent server | `3002` | Optional for UI testing |
| **xyne-claw-auth backend** | `3003` | Credential manager, OAuth flows |
| PostgreSQL | `5433` | `xyne_dev_db` (main) + `claw_auth_db` (claw) |
| Redis | `6379` | BullMQ queues, run recovery |
| Xyne Spaces dashboard | `5173` | Main frontend |
| **xyne-claw-auth frontend** | `5174` | Claw auth UI (`/claw/` base path) |
