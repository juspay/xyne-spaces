# Zero Mutators

## Locations

| File | Purpose |
|------|---------|
| [backend/src/zero/mutators.ts](../../../src/zero/mutators.ts) | Server-side mutations (~6000 lines) |
| `dashboard/src/zero/mutators.ts` | Client-side mutations (must mirror server) |

## AuthData Type

```typescript
export type AuthData = {
  sub: string;    // User ID
  email: string;  // User email
  name: string;   // User name
};
```
## Namespace Organization

Mutators are grouped by domain:

```typescript
defineMutators(schema, {
  channel: {
    createChannel: ...,
    joinChannel: ...,
    leaveChannel: ...,
  },
  message: {
    sendMessage: ...,
    editMessage: ...,
    deleteMessage: ...,
  },
  ticket: {
    createTicket: ...,
    updateTicket: ...,
  },
});
```

## Side Effects

Mutators can schedule side effects:

```typescript
async ({ tx, args }) => {
  // Main mutation
  await tx.mutate.tickets.insert({ ... });

  // Side effects queued via server.ts
  // - Vespa indexing
  // - Notifications
  // - Activity logging
}
```

## ACL Wrapping

Mutators are wrapped with ACL in `server.ts`:

```typescript
// backend/src/zero/acl/wrappers/mutator-wrapper.ts
const wrappedMutators = wrapMutatorsWithACL(
  mutators,
  authData,
  vespaJobs,
  sideEffectJobs
);
```

## Syncing with Dashboard

**Critical**: Mutator signatures must match exactly between backend and dashboard, but the logic may not be same.

| Aspect | Requirement |
|--------|-------------|
| Namespace | Same names |
| Mutator name | Identical |
| Args schema | Matching Zod schema |
| Return type | Compatible |

## Frontend Mutators - Optimistic Updates

Frontend mutators **must be optimistic** - they update UI immediately before server confirmation.

### UUIDs and Dates as Parameters

Generate UUIDs and timestamps **before** calling the mutator, pass them as args:

```typescript
//  Correct - generate on frontend, pass as parameter
const id = crypto.randomUUID();
const createdAt = Date.now();
await zero.mutate.ticket.createTicket({ id, name, createdAt });

//  Wrong - generating inside mutator (non-deterministic)
await zero.mutate.ticket.createTicket({ name }); // id generated inside
```

### Why?

- Optimistic updates need predictable values
- Frontend and backend must produce identical state
- Non-deterministic values (uuid(), Date.now()) inside mutators cause sync conflicts

## Transaction Performance Rules

Keep the main transaction block **lightweight**. Heavy work belongs in:
1. **Before calling mutator** (frontend pre-processing)
2. **Async tasks array** (server-side background processing)
3. **Side effects** (notifications, indexing, logging)

```typescript
//  Correct - lightweight transaction
async ({ tx, args }) => {
  await tx.mutate.tickets.insert(args);
  // Heavy work goes to side effects (handled by server.ts)
}

//  Wrong - heavy work in transaction
async ({ tx, args }) => {
  await tx.mutate.tickets.insert(args);
  await sendEmail(args);           // Blocks transaction
  await callExternalAPI(args);     // Network latency
  await generateReport(args);      // CPU intensive
}
```

## Do's 

- Group mutators by domain namespace
- Use Zod for argument validation
- Access `authData.sub` for current user
- Use `tx.run()` for queries within transactions
- Keep backend and dashboard mutators in sync
- Use helper functions for shared logic
- Generate UUIDs and dates for the columns of the table that are changed on frontend, pass as args
- Keep frontend mutators optimistic
- Keep transactions fast and lightweight
- Offload heavy work to async tasks or side effects

## Don'ts 

- Don't call external APIs directly in mutators (use side effects)
- Don't bypass ACL wrapping
- Don't create inconsistent state (atomic operations)
- Don't forget to sync changes to dashboard
- Don't put query logic in mutators (queries are separate)
- Don't access `db` (Prisma) directly - use `tx` (Zero transaction)
- Don't generate UUIDs/timestamps inside mutators
- Don't do network calls in transaction block
- Don't add CPU-heavy logic in main transaction
- Don't block transactions with async operations that aren't tx operations
