# Zero Schema - Frontend

## Location

**Single source of truth**: `shared/src/zero/schema.ts`

The schema is defined in the shared package and used by both backend and frontend.

## Schema Access

```typescript
import { schema } from '@xyne/shared';
import { zql } from '@/zero/queries';

// zql is the query builder
const tickets = zql.tickets.where('id', ticketId);
```

## Frontend Usage

| Task | Approach |
|------|----------|
| Query data | Use `zql` builder from queries.ts |
| Access types | Import from `@xyne/shared` |
| Access enums | Import from `@xyne/shared` |

## Type Imports

```typescript
import {
  schema,
  ChannelVisibility,
  TicketStatus,
  MessageType,
  // ... other types
} from '@xyne/shared';
```

## ACLs

Query ACLs are defined in `shared/src/zero/acl/` and automatically applied on backend. Frontend doesn't need to implement ACL logic.

## Do's 

- Import types from `@xyne/shared`
- Use `zql` builder for queries
- Reference schema for available tables/fields

## Don'ts 

- Don't define schema in dashboard
- Don't duplicate ACL logic on frontend
- Don't modify shared schema without coordinating
