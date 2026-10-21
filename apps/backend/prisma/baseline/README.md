# Baseline for empty databases

The migrations in `../migrations` cannot be replayed on an empty database: some are dated
before the migrations they depend on. An empty database is instead created from this
baseline, and every migration listed in `migrations.txt` is recorded as already applied.
Migrations added after the baseline are applied on top with `prisma migrate deploy` as usual.
Existing databases never use the baseline.

| File | What it is |
|---|---|
| `schema.sql` | the full schema, generated from `../schema.prisma` |
| `extras.sql` | what the schema cannot express: extensions, sequences, partial and GIN indexes, reference rows. Keep it idempotent |
| `migrations.txt` | the migrations the baseline already contains |

The `xyne-backend` Helm chart applies it in its migration Job (`migrations` in its values), then
runs `scripts/seed-acl.ts` and `scripts/seed-app-permissions.ts`.

## Refreshing it

Refreshing is optional: newer migrations apply on top of an older baseline. Refresh it when a
migration adds something `schema.prisma` cannot express, and add that to `extras.sql`.

```bash
cd apps/backend
pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/baseline/schema.sql
ls prisma/migrations | grep -v '^migration_lock.toml$' > prisma/baseline/migrations.txt
```

Check it against an empty Postgres before committing: apply `schema.sql` and `extras.sql`, record
the history, and `prisma migrate deploy` must report no pending migrations.
