# Backend Development Guidelines

## Quick Start

```bash
# Start backend server
npm run dev

# Start worker (background jobs)
npm run dev:worker

# Type check
npm run typecheck

# Lint
npm run lint
```

## Tech Stack

| Technology | Purpose |
|------------|---------|
| Hono | HTTP framework |
| Prisma | ORM / Database |
| PostgreSQL | Primary database |
| BullMQ + Redis | Job queues |
| Zero (Rocicorp) | Real-time sync |
| Vespa | Vector search |
| OpenTelemetry | Observability |

---

## Documentation Structure

| File/Folder | Description |
|-------------|-------------|
| [SETUP.md](SETUP.md) | Environment setup, OrbStack, Docker, npm install |
| [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) | Directory structure, layers, import conventions |
| [SERVICES.md](SERVICES.md) | All services catalog with descriptions |
| [JOBS.md](JOBS.md) | Queues, workers, background processing |
| [AUTH.md](AUTH.md) | Authentication, authorization, middleware |
| [WORKFLOWS.md](WORKFLOWS.md) | Workflow engine, stages, automation |
| [INTEGRATIONS.md](INTEGRATIONS.md) | External integrations overview |
| [integrations/](integrations/) | Individual integration docs (Slack, Zoho, Bitbucket, Jenkins, JAF) |
| [zero/](zero/) | Zero sync framework (overview, queries, mutators, schema) |

---

## General Guidelines

### Before Writing Code

1. **Read the docs** - Check relevant documentation files above
2. **Read existing code** - Understand current patterns before adding new ones
3. **Ask questions** - Clarify requirements and design patterns before implementing
4. **Understand unusual code** - Ask about any code that seems non-standard

### When Making Changes

| Guideline | Details |
|-----------|---------|
| Stick to requirements | Don't add extra features not asked for |
| Use existing tables | Exhaust options before proposing schema changes |
| Keep changes clean | Small, understandable, reviewable changes |
| No revolutionary changes | Incremental improvements over rewrites |
| Suggest table modifications | Before creating new tables, consider modifying existing |

### API vs Zero (Mutators/Queries)

| Use Case | Approach |
|----------|----------|
| Real-time UI data | Zero queries + mutators |
| Background processing | REST API |
| External integrations | REST API |
| File uploads | REST API |
| Simple CRUD with live updates | Zero |

---

## Logging

| Level | Usage |
|-------|-------|
| `info` | Mandatory visibility items only |
| `debug` | Development/troubleshooting details |
| `error` | Exceptions and failures |

**Rules:**
- Never use emojis in logs
- Log only what's necessary for production visibility
- Include context (userId, requestId, entityId)

---

## Error Handling

- Wrap async code in try-catch
- Use `AppError` for application errors with status codes
- Let errors bubble up to global error handler
- Log errors with full context
- Return consistent error responses

---

## ACL & Middleware

- Use authentication middleware on all protected routes
- Apply rate limiting where needed
- Use ACL wrappers for Zero mutations (see [zero/overview.md](zero/overview.md))
- Define Query ACLs for read permissions (see [zero/schema.md](zero/schema.md))

---

## Using Existing Components

Before creating new implementations, check:

| Component | Location |
|-----------|----------|
| Services | `src/services/` - see [SERVICES.md](SERVICES.md) |
| Integrations | `src/integrations/` - see [INTEGRATIONS.md](INTEGRATIONS.md) |
| Queues | `src/queues/` - see [JOBS.md](JOBS.md) |
| Workers | `src/workers/` - see [JOBS.md](JOBS.md) |
| Middleware | `src/middleware/` |
| Utils | `src/utils/` |

---

## Do's 

- Read docs and code before making changes
- Ask about design patterns before implementing
- Use existing services, queues, integrations
- Keep logs minimal and meaningful
- Wrap code in try-catch with proper handling
- Use proper ACL and middleware
- Update documentation when making changes that affect guidelines
- Maintain backward compatibility for DB schemas and API/URL paths unless explicitly told to break it
- Read `dashboard/docs/guidelines/CLAUDE.md` when doing frontend changes

## Don'ts 

- Don't add tables without exhausting existing options
- Don't write extra features not in requirements
- Don't make revolutionary changes
- Don't use emojis in code or logs
- Don't bypass ACL wrappers
- Don't duplicate existing functionality

---

## Common Fixes

| Issue | Solution |
|-------|----------|
| Continuous refresh on frontend | Delete all nodes and volumes in OrbStack, start setup fresh |
| TypeScript errors | Run `npm run db:push` in backend folder, then `npm install` in both dashboard and backend |
