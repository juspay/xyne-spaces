# Zero Sync Framework - Overview

## What is Zero?

Zero is a real-time sync framework from [Rocicorp](https://github.com/rocicorp/mono) enabling offline-first, reactive data sync between clients and server.

**Docs**: https://zero-docs-git-aa-v025.preview.rocicorp.dev/docs/release-notes/0.25

## Why Zero?

- **Real-time sync**: Changes propagate instantly to all connected clients
- **Optimistic updates**: UI updates immediately, syncs in background
- **Offline support**: Works offline, syncs when reconnected
- **Type-safe**: Full TypeScript support with ZQL (Zero Query Language)

## Architecture

```
Dashboard (Client)          Backend (Server)
├── queries.ts              ├── server.ts      ← Entry point
├── mutators.ts             ├── queries.ts     ← Query definitions
└── Zero Provider           ├── mutators.ts    ← Mutation logic
                            └── acl/           ← Mutation ACLs

Shared
├── schema.ts               ← Single source of truth
└── acl/                    ← Query ACLs
```

## Server Entry Point

**Location**: [backend/src/zero/server.ts](../../../src/zero/server.ts)

| Function | Purpose |
|----------|---------|
| `handleMutate()` | Processes mutations with auth, rate limiting, ACL wrapping |
| `handleQueries()` | Processes queries with auth and context |
| `extractAuthDataFromRequest()` | JWT verification (issuer: `xyne`, audience: `xyne`) |

### Mutation Flow

```
Request → JWT Auth → Rate Limit → ACL Wrap → Execute Mutator → Vespa Jobs → Side Effects
```

### Query Flow

```
Request → JWT Auth → Rate Limit → Execute Query with Context → Return Result
```

## Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Schema | `shared/src/zero/schema.ts` | Table definitions, enums, relationships |
| Queries | `backend/src/zero/queries.ts` | Server-side query definitions |
| Mutators | `backend/src/zero/mutators.ts` | Server-side mutation logic |
| Query ACLs | `shared/src/zero/acl/` | Read permission filters |
| Mutation ACLs | `backend/src/zero/acl/` | Write permission wrappers |

## ZeroController

Registered in Hono router:

```typescript
zeroController.post('/zero/push', (c) => handleMutate(c.req.raw));
zeroController.post('/zero/query', (c) => handleQueries(c.req.raw));
```

## Do's 

- Use `defineQuery()` from shared for query ACL auto-application
- Use `wrapMutatorsWithACL()` for mutation ACL enforcement
- Include rate limiting on all Zero endpoints
- Log mutations and queries with latency metrics
- Use `ctx.userID` for user-scoped operations

## Don'ts 

- Don't bypass ACL wrappers
- Don't call mutators directly without transaction wrapping
- Don't expose Zero endpoints without JWT verification
- Don't modify `server.ts` without understanding the full flow
- Don't forget to handle Vespa jobs for search indexing
