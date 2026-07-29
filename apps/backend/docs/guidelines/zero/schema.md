# Zero Schema

## Location

**Single source of truth**: [shared/src/zero/schema.ts](../../../../shared/src/zero/schema.ts)

## Tables

| Task | Location | Reference |
|------|----------|-----------|
| Create new table | `shared/src/zero/schema.ts` | Look at existing tables like `ticketTable`, `userTable` |
| Define columns | Same file | Use `string()`, `boolean()`, `number()`, `json<T>()`, `enumeration()` |
| Set primary key | Same file | Chain `.primaryKey('id')` |
| Create enum | Same file | Define TypeScript enum with `// @ts-ignore TS1294` |

## Relationships

| Task | Location | Reference |
|------|----------|-----------|
| Define relationships | `shared/src/zero/schema.ts` | Look at `ticketTableRelationships` pattern |
| One-to-one | Same file | Use `one()` with sourceField/destField |
| One-to-many | Same file | Use `many()` with sourceField/destField |

## Schema Export

After adding tables, export them in `createSchema()` at the bottom of `shared/src/zero/schema.ts`.

---

# ACL (Access Control Lists)

## Query ACLs (Read Permissions)

| Task | Location |
|------|----------|
| Create new ACL class | `shared/src/zero/acl/tables/` |
| Reference pattern | Look at `TicketsACL`, `ChannelsACL` |
| Export ACL | `shared/src/zero/acl/tables/index.ts` |
| Register in factory | `shared/src/zero/acl/core/query-acl-factory.ts` |

Implement `canSelect()` method to filter queries based on `ctx.userID`.

## Mutation ACLs (Write Permissions)

| Task | Location |
|------|----------|
| ACL wrappers | `backend/src/zero/acl/wrappers/` |
| Transaction wrapper | `backend/src/zero/acl/wrappers/transaction-wrapper.ts` |
| Mutator wrapper | `backend/src/zero/acl/wrappers/mutator-wrapper.ts` |

Mutations are wrapped automatically in `server.ts` via `wrapMutatorsWithACL()`.

---

## Do's 

- Define all tables in `shared/src/zero/schema.ts`
- Use TypeScript enums with `// @ts-ignore TS1294`
- Define relationships for foreign keys
- Create Query ACL for every table with sensitive data
- Export ACLs from `shared/src/zero/acl/tables/index.ts`
- Use `ctx.userID` for user-scoped filtering

## Don'ts 

- Don't define schema in multiple places
- Don't forget to add relationships for foreign keys
- Don't leave tables without ACL consideration
- Don't return `query` unchanged in ACL if filtering needed
- Don't bypass `defineQuery` wrapper (it applies ACLs)
- Don't hardcode user IDs in ACLs
