# XYNE-67466: retire external per-turn reminder configuration

Both `Agent.config.promptInjection` (string) and `promptInjections` (array)
are retired. Runtime does not consume either key, even if a stale client,
queued payload or service forwards it. Internal ids, labels and `system` flags
in external config do not establish trust.

## Preserved behavior

Ordinary messages, agent system prompts, skills and independent security
settings are unchanged. Task-command and Digital Twin reminders remain
code-owned. Editable design-system text and memory cluster names are now
reference context, not interpolated per-turn instructions. Reference text still
reaches the model: this is not a claim of universal prompt-injection immunity.

## Deployment order

1. Deploy Claw runtime to every worker/replica; drain/restart old workers and
   account for in-flight sessions. An old runtime can still consume retired keys.
2. Deploy Claw Auth's Agent write guard, then the dashboard and Auth UI.
   The Prisma query extension sanitizes config-bearing Agent creates, updates,
   bulk writes and upserts, including clones and provisioning. Raw SQL and
   independent scripts using a different Prisma client are outside this guard;
   do not reintroduce the keys through those paths.
3. Confirm ordinary chat, /design, /dashboard, task-command delivery and a Twin
   with memory work. Verify a stale payload containing both keys (including
   spoofed internal ids) never appears as a new per-turn reminder.
4. Only then consider optional stored-config cleanup. No schema change or
   production data cleanup is needed for runtime enforcement.

## Optional configuration cleanup

Use the Claw Auth database, not the Spaces database. A database operator must
confirm schema/table names and take a durable backup of affected rows first.
Dry-run the predicate below and inspect the config keys before applying it.
Run backup and update in the same transaction with row locks (or pause config
writes), so concurrent edits are not lost. Backup must include agent id, original
config and timestamp and live outside ephemeral sessions. Repeat dry-run after
cleanup; the update is idempotent and removes only the two top-level keys.

```sql
-- Dry run: no config text is printed.
SELECT id FROM "agents"
WHERE config::jsonb ?| ARRAY['promptInjection', 'promptInjections'];

-- Apply ONLY after backed-up/locked rows and approved maintenance procedure.
UPDATE "agents"
SET config = (config::jsonb - 'promptInjection' - 'promptInjections')
WHERE config::jsonb ?| ARRAY['promptInjection', 'promptInjections'];
```

## Rollback and residual risk

Roll back UI independently if necessary. Do not roll runtime back to a consumer
of retired keys: restored configuration or queued payloads could reactivate them.
If restoring backed-up config, merge only under a reviewed maintenance procedure
that preserves subsequent edits. Existing transcripts/compacted summaries may
still contain historical reminder text; this change does not erase history.
No production configuration, queue or transcript inspection was performed as
part of this code change.
