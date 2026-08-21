# Self-serve Slack migration

Bring Slack **DMs, group DMs, and channels** into Xyne Spaces from a dashboard page.
Two-phase pipeline: **collect** (Slack → GCS, streamed + encrypted) → admin **approve** → **ingest** (GCS → DB, fully offline). Redis-backed jobs on serial Bull queues.

## What's included
- Backend `migration/self-serve/*`: job store, two serial queues, collection/ingest engine, workers, REST API, envelope encryption, and an offline Slack reference (no Slack calls at ingest).
- Dashboard page: token/channel submit, live progress (DM %, channel date-window %), admin approve/stop/resume/delete + ingestion gate.
- Channel submit now **rejects** if the bot isn't in the channel or the requester isn't a member (prevents "migrated but empty" channels). Group DMs now migrate (mpim members are fetched).

## Folder structure
```
apps/backend/src/migration/self-serve/
  index.ts            composition root (store/queues/engine/workers/routes)
  types.ts            job + view models
  store.ts            Redis job store (record + index + per-person/channel locks)
  queues.ts           two serial Bull queues (jobId = migrationId, idempotent)
  workers.ts          collect / ingest processors + reconcile
  engine.ts           Slack → GCS collection (streamed) + offline ingest
  service.ts          submit / approve / stop / resume / delete + validation
  routes.ts           REST API (member routes + admin-gated)
  migrationCrypto.ts  envelope encrypt/decrypt (stream + buffer)
apps/backend/src/integrations/.../utils/slackOfflineReference.ts   offline resolver
apps/dashboard/src/
  pages/SlackMigration.tsx     the page
  api/slackMigrationApi.ts     client
  config.ts · routes/AppRoot.tsx · components/AppSidebar/navigationConfig.ts   wiring
```

## Screenshots
- **Dashboard:** _attach PNG_
- **Encrypted data at GCS:** _attach PNG_ (dumps + attachments are AES-encrypted at rest)

## Attachments
Streamed Slack → encrypt → GCS (`uploadStreamToPath(encryptStream(res.body))`) — never buffered whole in the pod (bounded memory, any file size).

## Rates (defaults)
| Stage | Env knob | Default | Ceiling |
|---|---|---|---|
| Fetch (collect) | `MIGRATION_SLACK_PAGE_DELAY_MS` | 1000 ms/page (200 msgs/page) | ~200 msg/s |
| Ingest | `MIGRATION_INGEST_MESSAGE_DELAY_MS` | 2 ms/msg | ~500 msg/s |
| Slack request timeout | `MIGRATION_SLACK_REQUEST_TIMEOUT_MS` | 30000 ms | — |
| Attachment timeout | `MIGRATION_SLACK_FILE_TIMEOUT_MS` | 200000 ms | — |

## Deploy-time env
**Backend — required**
- `RUN_SLACK_MIGRATION_WORKERS=true` — on the **single** migration pod only (API pods leave it unset).
- `MIGRATION_GCS_BUCKET` — dedicated bucket for dumps + attachments.
- `MIGRATION_ENC_KEYS` (JSON `{"id":"base64key"}`) + `MIGRATION_ENC_ACTIVE` (active key id) — envelope encryption.
- `SLACK_BOT_TOKEN` — central bot token (channel migrations).
- `MIGRATION_SLACK_BOT_CONFIGS` — per-workspace bot config (team→workspace map, notice text).
- Redis (`REDIS_*`, existing). Seed the `SLACK-MIGRATION-INGEST` ACL resource to gate ingestion.

**Backend — optional** (tunable; defaults in the table): `MIGRATION_SLACK_PAGE_DELAY_MS`, `MIGRATION_SLACK_REQUEST_TIMEOUT_MS`, `MIGRATION_SLACK_FILE_TIMEOUT_MS`, `MIGRATION_INGEST_MESSAGE_DELAY_MS`.

**Dashboard**
- `VITE_SLACK_APP_INSTALL_URL` — Slack app install page where users copy their user token.
