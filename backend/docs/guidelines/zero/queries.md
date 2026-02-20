# Zero Queries

## Locations

| File | Purpose |
|------|---------|
| [backend/src/zero/queries.ts](../../../src/zero/queries.ts) | Server-side queries |
| `dashboard/src/zero/queries.ts` | Client-side queries (**must be exactly same** as backend) |

## Frontend vs Backend Queries

Unlike mutators (which can differ), **frontend queries must be identical to backend queries**. ACLs are applied automatically via `defineQuery` wrapper - don't repeat ACL logic in query definitions.

## Query Performance Rules

### Avoid Repeated Point Queries

Don't call single-item queries repeatedly on the same screen:

```typescript
//  Wrong - calling getTicketById for each ticket card
tickets.forEach(t => useQuery(q.getTicketById, { id: t.id }));

//  Correct - use list query that returns all needed data
useQuery(q.allTickets);  // Returns all tickets with needed fields
```

### Minimize `.related()` Usage

`.related()` is a JOIN operation - use sparingly:

```typescript
//  Heavy - multiple nested relations
zql.tickets
  .related('project')
  .related('assignments', (a) => a.related('user'))
  .related('activities', (a) => a.related('user'))
  .related('tags');

//  Lighter - only essential relations
zql.tickets
  .related('assignments');
```

### Keep Queries Light

| Problem | Solution |
|---------|----------|
| Too many `.related()` | Denormalize data or break into separate queries |
| Heavy joins | Add summary fields to parent table |
| Slow list queries | Use pagination with `.limit()` |
| Repeated point queries | Use batch/list query instead |

### When Queries Get Heavy

1. **Denormalize**: Add computed/cached fields to the table
2. **Break queries**: Separate into multiple lighter queries
3. **Review schema**: Check if relationships can be flattened

## ZQL Reference

### Basic Operations

```typescript
zql.tableName                        // Start query
  .where('field', value)             // Exact match
  .where('field', '>', value)        // Comparison
  .where(({ or, cmp }) =>            // Complex conditions
    or(cmp('a', 1), cmp('b', 2))
  )
  .orderBy('field', 'asc')           // Sorting
  .limit(10)                         // Limit results
  .one()                             // Single result
```

### Relationships

```typescript
zql.conversations
  .related('messages')               // Include related
  .related('messages', (q) =>        // Filter related
    q.where('isDeleted', false)
      .orderBy('createdAt', 'asc')
  )
```

### Existence Checks

```typescript
zql.channels
  .whereExists('participants', (p) =>
    p.where('userId', ctx.userID)
  )
```

## Context

Every query receives `ctx` with:
- `ctx.userID`: Authenticated user's ID

```typescript
defineQuery(({ ctx }) => {
  return zql.notifications
    .where('userId', ctx.userID);  // User-scoped query
});
```

## ACL Auto-Application

ACLs are defined in `shared/src/zero/acl/tables/` - **not in queries**.

```typescript
// shared/src/zero/acl/define-query.ts
// Extracts table name from query AST
// Gets ACL class from QueryACLFactory
// Applies canSelect() filter automatically
```

## Do's 

- Use `defineQuery` from `@xyne/shared` (not from `@rocicorp/zero` directly)
- Add Zod validation for query arguments
- Use `ctx.userID` for user-scoped data
- Keep frontend and backend queries **exactly identical**
- Write ACLs in ACL files only, not in query definitions
- Use list queries instead of repeated point queries
- Keep queries as light as possible
- Consider denormalization for heavy queries

## Don'ts 

- Don't use `zeroDefineQuery` directly (bypasses ACL)
- Don't return unbounded queries (always limit or scope)
- Don't put business logic in queries (use mutators)
- Don't query sensitive fields without ACL consideration
- Don't call point queries (e.g., `getById`) repeatedly in loops
- Don't add unnecessary `.related()` calls (they are joins)
- Don't duplicate ACL logic in queries - use ACL classes
- Don't let queries become heavy - denormalize or break them up
