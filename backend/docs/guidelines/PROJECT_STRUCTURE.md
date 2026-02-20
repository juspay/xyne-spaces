# Backend Project Structure

---

## Overview

The backend follows a **layered architecture** with clear separation of concerns:

```
Request → Routes → Controllers → Services → Repositories → Database
              ↑
         Middleware (auth, validation, rate limiting)
```

---

## Source Directory (`src/`)

| Directory | Purpose |
|-----------|---------|
| `config/` | Environment configuration with Joi validation |
| `routes/` | API endpoint definitions (~60 files) |
| `controllers/` | HTTP request/response handlers (~55 files) |
| `services/` | Business logic layer (~80 files) |
| `database/` | Prisma client and repositories (~45 repos) |
| `middleware/` | Auth, validation, error handling, rate limiting |
| `types/` | TypeScript type definitions |
| `utils/` | Shared utility functions (logger, cache, etc.) |
| `validators/` | Joi request validation schemas |
| `queues/` | BullMQ job queue definitions |
| `workers/` | Background job processors |
| `workflows/` | Multi-step workflow engine |
| `agents/` | AI agents (xyne-ai, summariser, etc.) |
| `bots/` | Bot implementations with unified interface |
| `integrations/` | External platform adapters (Zoho, Slack, Jira) |
| `vespa/` | Vector search integration |
| `zero/` | Real-time sync engine (must sync with dashboard) |

---

## Layered Architecture

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Routes** | `src/routes/` | Endpoint definitions, apply middleware |
| **Controllers** | `src/controllers/` | Parse requests, format responses |
| **Services** | `src/services/` | Business logic, orchestration |
| **Repositories** | `src/database/repositories/` | Data access, Prisma queries |

**Rules:**
- Each layer only calls the layer directly below it
- Never skip layers (controller → repository is forbidden)
- Services may call other services for complex operations

---

## Configuration

**Location:** `src/config/env.ts`

- All environment variables validated at startup with Joi
- Access via `config` object: `import { config } from '@/config/env'`
- Environment files: `.env`, `.env.example`, `.env.test`, `.env.local`

---

## Key Directories

### Routes (`src/routes/`)
API endpoint definitions. Each file corresponds to a feature (e.g., `tickets.ts`, `users.ts`, `channels.ts`). Routes apply middleware and connect to controllers.

### Controllers (`src/controllers/`)
HTTP request handlers. Parse requests, call services, format responses. Never contain business logic or direct database access.

### Services (`src/services/`)
Business logic layer. Orchestrate operations, handle transactions, call repositories. Services may call other services. Complex features have subdirectories (e.g., `services/tickets/`, `services/search/`).

### Database (`src/database/`)
Data access layer. Contains `client.ts` (Prisma singleton) and `repositories/` (data access classes). All repositories extend `base.ts` for common operations.

### Queues (`src/queues/`)
BullMQ job queue definitions with Redis. Each queue handles a specific type of background work (Vespa indexing, ETA deadlines, presence cleanup, metrics sync).

### Workers (`src/workers/`)
Process jobs from queues. Workers run in a separate process (`worker.ts`) and handle async tasks like indexing, cleanup, and sync operations.

### Workflows (`src/workflows/`)
Multi-step workflow engine for complex processes (bug workflows, feature implementation, onboarding). Contains workflow definitions, execution engines, step registry, and persistence layer.

### Agents (`src/agents/`)
AI agents for automated tasks. Includes `xyne-ai/` (main AI), `summariser/`, `ticket-duplicate/` (detection), `ticket-cleaning-and-themes/`, and `activity-classification/`.

### Integrations (`src/integrations/`)
External platform adapters using adapter pattern. Each integration has: authenticator, transformer, and optional flow.

### Vespa (`src/vespa/`)
Vector search integration for semantic search. Contains Vespa client, configuration, and search operations.

### Zero (`src/zero/`)
Real-time sync engine. Contains queries (ZQL) and mutators. **Critical:** Changes must be synchronized with `dashboard/src/zero/`. Schema lives in `shared/src/zero/schema.ts`.

### Bitbucket (`src/bitbucket/`)
Git integration for Bitbucket. Handles webhooks, PR operations, and repository interactions.

### Notification Service (`src/notification-service/`)
Push notification handling. Manages FCM (Firebase Cloud Messaging) and APNS (Apple Push Notification Service) delivery.

### Hooks (`src/hooks/`)
Event hooks for side effects. Currently contains `notificationHooks.ts` for triggering notifications on events.

### Middleware (`src/middleware/`)
Express middleware for cross-cutting concerns: `auth.ts` (JWT), `errorHandler.ts` (AppError), `validation.ts`, `rateLimiters.ts`, `acl.ts` (access control).

### Types (`src/types/`)
TypeScript type definitions. Contains `express.ts` (request/response types), `database.ts`, and feature-specific types. Prefer Prisma-generated types when available.

### Utils (`src/utils/`)
Shared utilities: `logger.ts` (Winston with context), `cacheManager.ts`, `dateUtils.ts`, `mentionParser.ts`, etc.

### Validators (`src/validators/`)
Joi request validation schemas. Used by validation middleware to validate incoming requests.

---

## Database

**Location:** `prisma/schema.prisma`

- Multi-schema support: `public` (main tables), `workflow` (workflow tables)
- Migrations: `npx prisma migrate dev --name <name>`
- Client: Singleton in `src/database/client.ts`
- Repositories: Abstract base in `src/database/repositories/base.ts`
