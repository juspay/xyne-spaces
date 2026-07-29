# Zero Queries - Frontend

## Location

| File | Purpose |
|------|---------|
| [src/zero/queries.ts](../../../src/zero/queries.ts) | Frontend queries |
| `backend/src/zero/queries.ts` | Backend queries (**must match**) |

## Critical Rule

**Frontend queries must be EXACTLY identical to backend queries.**

ACLs are applied on backend via `defineQuery` wrapper - don't duplicate ACL logic.

## Using Queries

```typescript
import { useQuery } from '@/hooks/useQuery';
import { queries } from '@/zero/queries';

// In component
const [tickets] = useQuery(queries.allTickets);
const [channel] = useQuery(queries.getChannelById, { channelId });
```

## Query Performance

### Avoid Repeated Point Queries

```typescript
// Wrong - calling getTicketById for each card
tickets.map(t => useQuery(queries.getTicketById, { id: t.id }));

// Correct - use list query
const [tickets] = useQuery(queries.allTickets);
```

### Minimize Related Data

`.related()` calls are JOINs - use sparingly:

```typescript
// Heavy - too many relations
zql.tickets
  .related('project')
  .related('activities')
  .related('assignments');

// Light - only essential
zql.tickets.related('assignments');
```

## Do's

- Use `useQuery` hook
- Use list queries over repeated point queries
- Keep queries light
- Match backend exactly

## Don'ts

- Don't modify without updating backend
- Don't add unnecessary `.related()` calls
- Don't call queries in loops
- Don't duplicate ACL logic (handled by backend)
