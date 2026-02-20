# Zero Sync - Frontend Overview

## What is Zero?

Zero is a real-time sync framework from [Rocicorp](https://github.com/rocicorp/mono) enabling offline-first, reactive data sync.

**Docs**: https://zero-docs-git-aa-v025.preview.rocicorp.dev/docs/release-notes/0.25

## Frontend Architecture

```
dashboard/src/zero/
├── queries.ts      ← Query definitions (MUST match backend)
└── mutators.ts     ← Mutator definitions (optimistic updates)

shared/src/zero/
├── schema.ts       ← Single source of truth
└── acl/            ← Query ACLs
```

## Key Files

| File | Purpose |
|------|---------|
| `src/zero/queries.ts` | Frontend queries (identical to backend) |
| `src/zero/mutators.ts` | Frontend mutators (optimistic) |
| `src/providers/ZeroProvider.tsx` | Zero client setup |
| `src/hooks/useZero.ts` | Zero client hook |
| `src/hooks/useQuery.ts` | Query wrapper hook |

## Usage Pattern

```typescript
// Using Zero in components
const { zero } = useZero();
const [data] = useQuery(queries.myQuery, { id: '123' });

// Calling mutations
await zero.mutate.namespace.myMutation({
  id: crypto.randomUUID(),
  name: 'value',
  createdAt: Date.now(),
});
```

## Critical Rules

| Rule | Details |
|------|---------|
| Queries must match | Frontend queries identical to backend |
| Mutators optimistic | Must work without server response |
| UUIDs as parameters | Generate before calling mutator |
| Dates as parameters | Generate `Date.now()` before calling |

## Do's 

- Use `useQuery` hook for data fetching
- Generate UUIDs/timestamps before mutations
- Keep mutators lightweight
- Check backend queries when modifying frontend

## Don'ts 

- Don't generate UUIDs inside mutators
- Don't add heavy logic in mutators
- Don't modify queries without syncing backend
- Don't call point queries in loops
