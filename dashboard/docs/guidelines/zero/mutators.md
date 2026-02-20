# Zero Mutators - Frontend

## Location

| File | Purpose |
|------|---------|
| [src/zero/mutators.ts](../../../src/zero/mutators.ts) | Frontend mutators (~4300 lines) |
| `backend/src/zero/mutators.ts` | Backend mutators |

## Critical Rules

### 1. Optimistic Updates

Frontend mutators execute immediately before server confirmation. They must produce predictable, deterministic results.

### 2. UUIDs and Dates as Parameters

Generate **before** calling the mutator:

```typescript
//  Correct
const id = crypto.randomUUID();
const createdAt = Date.now();
await zero.mutate.ticket.createTicket({ id, title, createdAt });

//  Wrong - non-deterministic inside mutator
await zero.mutate.ticket.createTicket({ title }); // id generated inside
```

### 3. Keep Transactions Lightweight

No heavy logic in mutators:

```typescript
//  Correct - simple operations
async ({ tx, args }) => {
  await tx.mutate.tickets.insert(args);
}

//  Wrong - heavy operations
async ({ tx, args }) => {
  await tx.mutate.tickets.insert(args);
  await fetchExternalData();  // Network call
  await heavyComputation();   // CPU intensive
}
```

## Calling Mutators

```typescript
const { zero } = useZero();

// With pre-generated values
await zero.mutate.channel.joinChannel({
  channelId,
  channelParticipantId: crypto.randomUUID(),
  channelUserStatusId: crypto.randomUUID(),
  timestamp: Date.now(),
});
```

## Signature Matching

Mutator signatures must match backend, but logic may differ:

| Aspect | Requirement |
|--------|-------------|
| Namespace | Same as backend |
| Mutator name | Identical |
| Args schema | Matching Zod schema |
| Logic | Can differ (optimistic vs full) |

## Do's 

- Generate UUIDs/timestamps before calling
- Keep mutators fast and simple
- Match backend signatures
- Use Zod for argument validation

## Don'ts 

- Don't generate UUIDs inside mutators
- Don't add network calls in mutators
- Don't add heavy computation
- Don't forget to sync with backend
