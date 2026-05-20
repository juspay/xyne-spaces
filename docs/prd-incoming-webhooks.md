# PRD: Incoming Webhooks for Apps (Slack-Compatible Partial)

**Author:** Ameer Noufil
**Date:** 2026-04-29
**Status:** Final

---

## 1. Overview

Add Slack-compatible incoming webhook support to Xyne apps. An app (bot) installed in a workspace can generate incoming webhook URLs tied to specific channels. External services can POST messages to these URLs — same payload format as Slack incoming webhooks — and messages appear in the channel as the bot.

**Final draft scope:** All decisions finalized. Adds secret-based authentication (token in URL path — same pattern as Slack), `incoming_webhooks` DB table with per-channel secrets, attachments (legacy Slack format), thread replies (partial via `conversationId`), and security-hardened error responses (`400` over `404`). Resolves all prior limitations (7.1–7.5, 7.7).

---

## 2. Webhook URL Format

```
POST /api/apps/webhooks/<workspaceId>/<appId>/<secret>
```

Maps 1:1 with Slack's 3-segment pattern:

| Slack                          | Xyne                                                  |
| ------------------------------ | ----------------------------------------------------- |
| `T00000000` (team/workspace) | `workspaceId`                                       |
| `B00000000` (bot/app)        | `appId` (InstalledApps.id)                          |
| `XXXXXXXX` (token/secret)    | `secret` (random token — channel resolved from DB) |

Channel is **not in the URL**. The `secret` uniquely identifies the webhook, which is tied to a specific channel in the `incoming_webhooks` table. This matches Slack's model: the token IS the channel binding.

**Example:**

```
POST https://xyne.example.com/api/apps/webhooks/ws_abc123/app_def456/a1b2c3d4e5f6...
Content-Type: application/json

{"text": "Build #42 passed successfully"}
```

---

## 3. Slack Compatibility

The endpoint must accept the same payload formats Slack incoming webhooks accept, so anywhere a Slack webhook URL is configured, a Xyne webhook URL can be used as a drop-in replacement.

### Supported Payload Formats

**Basic text message:**

```json
{"text": "Hello from webhook!"}
```

**With blocks (Slack Block Kit):**

```json
{
  "text": "Fallback text",
  "blocks": [
    {
      "type": "section",
      "text": {"type": "mrkdwn", "text": "*Build #42* passed"}
    }
  ]
}
```

**With attachments (legacy Slack format):**

```json
{
  "text": "Fallback text",
  "attachments": [
    {
      "color": "#36a64f",
      "title": "Build #42",
      "title_link": "https://ci.example.com/builds/42",
      "text": "All 128 tests passed",
      "fields": [
        {"title": "Branch", "value": "main"},
        {"title": "Duration", "value": "2m 34s"}
      ],
      "footer": "CI Bot",
      "image_url": "https://ci.example.com/builds/42/graph.png"
    }
  ]
}
```

Supported attachment fields: `color`, `pretext`, `author_name`, `author_link`, `title`, `title_link`, `text`, `fields` (title/value pairs), `image_url`, `thumb_url`, `footer`, nested `blocks`. Color values: hex (`#36a64f`), or named (`good`, `warning`, `danger`). Rendered as styled blockquotes with colored left border — same as Slack's legacy attachment rendering.

> **Note:** `attachments` is Slack's legacy message format. Slack recommends Block Kit (`blocks`) for new integrations, but many existing services still send `attachments`. Both are supported simultaneously — if a payload contains both `blocks` and `attachments`, both are rendered (blocks first, then attachments).

**Thread reply (partially compatible):**

```json
{
  "text": "Thread reply via webhook",
  "conversationId": "<xyne-conversation-uuid>"
}
```

> **Partial compatibility — not a Slack drop-in for threads.** Slack uses `thread_ts` (message timestamps) for thread identification. Xyne uses `conversationId` (UUID) — a fundamentally different value. There is no mapping between the two, so `thread_ts` is **not accepted**. Callers must use Xyne's native `conversationId`, which can be obtained from the authenticated Apps API `postMessage` (returns message metadata including conversation ID) or other Xyne API endpoints.
>
> The webhook response remains `"ok"` with no message ID — same as Slack. This means a webhook cannot start a thread and then reply to it purely via webhooks — the first message creates a conversation, but the caller has no way to get the `conversationId` back from the webhook response alone.

### Behavior

- `text`, `blocks`, or `attachments` is required. Slack recommends top-level `text` as fallback for `blocks`, but Xyne accepts blocks-only and attachments-only payloads to match Slack webhook behavior.
- `blocks` — pass through to `SlackBlockKitParser` for rendering; falls back to `text` if blocks are empty/unsupported
- `attachments` — pass through to `SlackBlockKitParser.parseAttachments()` for legacy Slack attachment rendering
- **Channel membership required:** Bot and requesting user must both already be members of the target channel before a webhook can be created for it. Webhooks can only be created for channels where both are already present. **Slack difference:** In Slack, the bot is automatically added to the channel during webhook creation. In Xyne, the bot must be added to the channel first (via channel settings), then a channel member can create the webhook.
- Response: `200 OK` with body `"ok"` on success (matches Slack behavior)
- Errors: `400 no_text` for payloads with no message content, `400 invalid_payload` for malformed payloads or invalid workspace/app/secret combo, and `500 rollup_error` for internal failures. Xyne intentionally keeps invalid workspace/app/secret, inactive/revoked webhook, and bot-not-in-channel responses generic to avoid leaking valid identifiers.
- **No `404` responses** — all validation failures return `400` to prevent external callers from probing valid workspace/app combinations

---

## 4. User Flow (UI)

### 4.1 Entry Point — Apps Page, Bot Section

User navigates to `/:workspaceId/apps` → sees apps table → clicks **Edit** on an installed app.

### 4.2 Edit App View — New "Incoming Webhooks" Section

In the existing `EditAppForm` dialog, add a new section **below** the existing Webhook URL field:

```
┌─────────────────────────────────────────────────┐
│ Edit App: my-ci-bot                             │
├─────────────────────────────────────────────────┤
│ App Name:    [my-ci-bot          ] (disabled)    │
│ Description: [CI/CD notifications]              │
│ Webhook URL: [https://my-server.com/hook       ]│
│                                                 │
│ ── Incoming Webhooks ────────────────────────── │
│                                                 │
│ [+ Create Incoming Webhook]                     │
│                                                 │
│ Name: GitHub CI          Channel: #deployments  │
│ URL: https://xyne.../api/apps/webhooks/ws/app/a1b2.. │
│ [Copy] [Revoke]                                 │
│                                                 │
│ Name: Monitoring         Channel: #alerts       │
│ URL: https://xyne.../api/apps/webhooks/ws/app/c3d4.. │
│ [Copy] [Revoke]                                 │
│                                                 │
│              [Cancel]  [Save]                   │
└─────────────────────────────────────────────────┘
```

Multiple webhooks per channel are allowed (e.g., separate webhooks for GitHub CI and Monitoring posting to the same channel). Slack also supports this but has no identifier for each webhook — Xyne improves on this with a `name` field.

### 4.3 Create Incoming Webhook Flow

1. User clicks **"+ Create Incoming Webhook"**
2. User enters a **name** for the webhook (e.g., "GitHub CI", "Monitoring")
3. Dropdown shows only channels where both the bot and requesting user are already members (bot must be added to channel first via channel settings)
4. User selects a channel
5. Frontend calls backend API → backend generates secret, creates `incoming_webhooks` DB record, returns full URL
6. Webhook URL displayed with copy button — URL contains the secret, not reconstructable without it

> **Slack difference:** Slack auto-adds the bot to the channel during webhook creation. Xyne requires the bot to be a member first — the channel dropdown only shows shared channels where the bot and requesting user are both already present.

### 4.4 Webhook URL Display

- Show full URL with copy-to-clipboard button
- URL is read-only (contains server-generated secret)
- Show webhook name and channel name as labels
- Dashboard prefixes backend-returned relative paths with `VITE_APPS_PUBLIC_BASE_URL`, which must include the full whitelisted Apps domain and route prefix (for example, `https://spaces.xyne.juspay.net/api/apps`), then appends `/webhooks/...`

### 4.5 Revoke Webhook

- Revoke sets `isActive = false`, `revokedAt`, `revokedBy` in DB — permanent, no re-enable
- URL immediately stops working
- To replace: create a new webhook (new secret, new URL)

---

## 5. Backend Implementation

### 5.1 New Route

Add to existing apps routes in `backend/src/apps/routes/apps.ts`:

```typescript
router.post('/webhooks/:workspaceId/:appId/:secret', webhookLimiter, incomingWebhookController.handleIncoming);
```

Secret in URL path IS the authentication — no additional auth middleware needed. The route reuses the existing `webhookLimiter`.

### 5.2 Controller: `incomingWebhookController`

**File:** `backend/src/apps/controllers/incomingWebhookController.ts`

Logic:

1. Extract `workspaceId`, `appId`, `secret` from URL params
2. Validate workspace exists
3. Validate `appId` is an installed app in this workspace
4. Look up `incoming_webhooks` record by `installedAppId` — decrypt stored secret, constant-time compare with `secret` from URL
5. Verify webhook `isActive === true` and `revokedAt` is null — return `400` if inactive/revoked
6. Get `channelId` from the matched `incoming_webhooks` record (channel is NOT in URL)
7. Validate bot is a member of the channel (bot must be added to channel before webhook creation — see Section 4.3)
8. Extract `text`, `blocks`, `attachments`, and `conversationId` from request body
9. Parse content via `SlackBlockKitParser.parse({ text, blocks, attachments })` — parser already supports all three content types
10. If `conversationId` is provided, pass to `findOrCreateConversation` to post as thread reply; otherwise create new top-level conversation
11. Post message to channel as the bot user using existing `findOrCreateConversation` logic
12. Return `200 "ok"` on success

> **Implementation note (blocks bug):** Current controller defines `blocks` in the Zod schema but only destructures `text` from the validated body. Fix: destructure `{ text, blocks, attachments }` and pass all three to `blockKitParser.parse()`.

### 5.3 Reuse Existing Infrastructure

- **Message posting:** Reuse `ChatController.postMessage` or the underlying service — the app already has a `POST /api/apps/chat/postMessage` endpoint that posts as the bot. The webhook controller should use the same code path.
- **Channel membership check:** Use existing channel member queries
- **Workspace/App validation:** Use `InstalledAppsRepository` to find the installed app by ID and verify workspace match

### 5.4 DB Schema — `incoming_webhooks` Table

New table to store per-channel webhook registrations with secrets:

**Schema:** create table as `workflow.app_incoming_webhooks`, not `public.app_incoming_webhooks`. Public schema is reserved mostly for Zero-managed tables; this webhook table is backend-owned and should stay in the workflow schema.

| Column             | Type         | Constraints                                                      |
| ------------------ | ------------ | ---------------------------------------------------------------- |
| `id`             | TEXT         | PK, auto-generated CUID                                          |
| `installedAppId` | TEXT         | NOT NULL, FK →`installed_apps.id`                             |
| `channelId`      | TEXT         | NOT NULL, FK →`channels.id`                                   |
| `name`           | TEXT         | NOT NULL — webhook identifier (e.g., "GitHub CI", "Monitoring") |
| `secret`         | TEXT         | NOT NULL — encrypted via `encryptionService`                  |
| `isActive`       | BOOLEAN      | NOT NULL, default `true`                                       |
| `createdBy`      | TEXT         | NOT NULL, FK →`users.id`                                      |
| `createdAt`      | TIMESTAMP(3) | NOT NULL                                                         |
| `revokedAt`      | TIMESTAMP(3) | nullable — set when revoked, permanent                          |
| `revokedBy`      | TEXT         | nullable, FK →`users.id`                                      |

**Indexes:** `(installedAppId, channelId)` — not unique, multiple webhooks per channel allowed.

**Multiple webhooks per channel:** Same channel can have multiple webhooks (e.g., one for GitHub CI, one for Monitoring). Each has its own name, secret, and lifecycle. Slack also supports multiple hooks per channel but has no identifier — Xyne improves on this with the `name` field.

**Secret generation:** `crypto.randomBytes(32).toString('hex')` — same pattern as existing `signingSecret` in `installed_apps`. Stored encrypted via `encrypt()` from `encryptionService.ts`, decrypted at runtime for constant-time comparison.

**Webhook lifecycle:**

- **Create:** User selects channel (bot must already be member) + enters name → backend generates secret, creates record, returns full URL
- **Revoke:** Set `isActive = false`, `revokedAt = now()`, `revokedBy = userId`. Permanent — no re-enable. Create new webhook instead.
- **Regenerate:** Revoke old webhook, create new one (new secret, new URL)

### 5.5 Request Validation

**URL params:**

```typescript
interface IncomingWebhookParams {
  workspaceId: string;
  appId: string;
  secret: string;      // Webhook secret — channel resolved from DB
}
```

**Request body:**

```typescript
interface IncomingWebhookPayload {
  text?: string;                   // Optional when blocks or attachments are present
  blocks?: SlackBlock[];           // Optional — Slack Block Kit blocks
  attachments?: SlackAttachment[]; // Optional — legacy Slack attachments (colored sidebars, fields, images)
  conversationId?: string;         // Optional — Xyne conversation UUID to reply to (not Slack thread_ts — see Section 3)
}
```

> `SlackAttachment` type already exists at `backend/src/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitTypes.ts` — reuse it.

---

## 6. Implementation Plan

### Phase 1 — Backend

| Step | Task                                                                                                                     | File(s)                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1    | Create Prisma model for `workflow.app_incoming_webhooks` table                                                        | `backend/prisma/schema.prisma`                                    |
| 2    | Create migration for `workflow.app_incoming_webhooks` table                                                           | `backend/prisma/migrations/`                                      |
| 3    | Create `IncomingWebhooksRepository` with CRUD + secret lookup                                                          | `backend/src/database/repositories/incomingWebhooksRepository.ts` |
| 4    | Register repository in `backend/src/database/repositories/index.ts`                                                    | Repository index                                                    |
| 5    | Update `incomingWebhookController.ts` — extract `secret` from URL, validate via DB lookup, resolve `channelId`    | `backend/src/apps/controllers/incomingWebhookController.ts`       |
| 6    | Update public route from `/api/webhooks/:workspaceId/:appId/:secret` to `/api/apps/webhooks/:workspaceId/:appId/:secret` | `backend/src/apps/routes/apps.ts`                                  |
| 7    | Add webhook creation endpoint — generate secret, create DB record                                                       | Controller + route                                                  |
| 8    | Add webhook revocation endpoint — set `isActive = false`, `revokedAt`, `revokedBy`                                | Controller + route                                                  |
| 9    | Handle Slack payload format (`text`, `blocks`, `attachments`) — pass all three to `SlackBlockKitParser.parse()` | Controller                                                          |
| 10   | Add thread reply support — accept `conversationId` in body, pass to `findOrCreateConversation`                      | Controller                                                          |
| 11   | Return Slack-compatible responses (`"ok"`, error codes — all `400`, no `404`)                                     | Controller                                                          |
| 12   | Reuse existing `webhookLimiter` for global rate limiting                                                               | Apps route registration                                           |

### Phase 2 — Frontend

| Step | Task                                                               | File(s)                                                       |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| 1    | Add "Incoming Webhooks" section to `EditAppForm`                 | `dashboard/src/components/Apps/EditAppForm/EditAppForm.tsx` |
| 2    | Add webhook name input field                                       | EditAppForm                                                   |
| 3    | Add channel selector dropdown (fetch channels bot is member of)    | EditAppForm + new query                                       |
| 4    | Call backend API to create webhook (generates secret, returns URL) | EditAppForm                                                   |
| 5    | Add copy-to-clipboard for webhook URL                              | EditAppForm                                                   |
| 6    | Add webhook list display (name + channel + URL + copy + revoke)    | EditAppForm                                                   |
| 7    | Fetch existing webhooks from DB on form load                       | EditAppForm + new query                                       |

### Phase 3 — Testing

| Step | Task                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------- |
| 1    | Test basic `curl` POST with `{"text": "hello"}` using valid secret                                  |
| 2    | Test with Slack Block Kit payload (`blocks`)                                                          |
| 3    | Test with legacy Slack attachments payload (colored sidebar, fields, image_url)                         |
| 4    | Test combined payload (`text` + `blocks` + `attachments`)                                         |
| 5    | Test thread reply — POST with `conversationId` pointing to existing conversation                     |
| 6    | Test that a Slack webhook integration (e.g., GitHub → Slack) works by swapping Slack URL with Xyne URL |
| 7    | Test invalid secret returns 400                                                                         |
| 8    | Test revoked webhook (isActive=false) returns 400                                                       |
| 9    | Test invalid workspace/app combos return 400 (not 404 — no info leakage)                               |
| 10   | Verify message appears in channel as bot user                                                           |
| 11   | Test creating multiple webhooks for same channel with different names                                   |

---

## 7. Disadvantages & Known Limitations

> Items marked ✅ are resolved in the final draft. Remaining items are accepted trade-offs.

### ✅ 7.1 Secret/Signing Verification — RESOLVED

Secret token in URL path. Webhook URLs contain a `crypto.randomBytes(32)` secret — not guessable. Stored encrypted in `incoming_webhooks` table.

### ✅ 7.2 URL Guessability — RESOLVED

URL now includes random secret segment. `workspaceId` and `appId` are known, but `secret` is not discoverable — URL cannot be constructed without it.

### ✅ 7.3 Channel-Level Control — RESOLVED

`isActive` flag per webhook in `incoming_webhooks` table. Can disable individual webhooks without removing bot from channel.

### ✅ 7.4 Webhook Revocation — RESOLVED

Revoke sets `isActive = false`, `revokedAt`, `revokedBy`. Permanent — create new webhook to replace. Each webhook has independent lifecycle.

### ✅ 7.5 Webhook Audit Trail — RESOLVED

`incoming_webhooks` table tracks `createdBy`, `createdAt`, `revokedBy`, `revokedAt` per webhook.

### ✅ 7.6 Global Rate Limiting — RESOLVED

- Reuses existing `webhookLimiter` on the public `/api/apps/webhooks/...` route.
- No per-app or per-channel rate limiting in v1.

### ✅ 7.7 UI State Persistence — RESOLVED

Webhooks stored in `incoming_webhooks` DB table. UI fetches from DB on load.

---

## 8. Discussion Needed

### ~~8.1 Attachments Support~~ → DECIDED: Supported

Legacy Slack `attachments` field is now supported. `SlackBlockKitParser` already handles attachment parsing (colored sidebars, fields, images, author, footer). Controller needs to pass `attachments` through to the parser. See Section 3 for payload format and Section 5.2 for implementation details.

### 8.2 File Attachments via Webhook

Attaching files (images, documents) through incoming webhooks is **not possible** with the current approach. Slack incoming webhooks also don't support file uploads — files require a separate `files.upload` API call with auth. Same limitation applies here. Workaround: use image URLs in message text or attachment `image_url` field.

### ~~8.3 Reply to Thread~~ → DECIDED: Partially Supported (`conversationId` only)

**Decision:** Thread replies supported via `conversationId` field. **Not Slack-compatible for threads** — Slack's `thread_ts` (message timestamps) cannot map to Xyne's `conversationId` (UUID). These are fundamentally different value types with no conversion path.

**How it works:**

- Caller passes `conversationId` (Xyne UUID) in webhook payload
- Maps to `conversationId` parameter in `findOrCreateConversation`
- If valid conversation ID, message posts as thread reply; otherwise creates new top-level conversation
- Webhook response remains `"ok"` — no message/conversation ID returned

**Limitation:** Cannot start a thread and reply to it purely via webhooks. First POST creates a conversation but returns no ID. Caller must obtain `conversationId` from authenticated Apps API `postMessage` or other Xyne endpoints.

### ~~8.4 Webhook Secret / Authentication~~ → DECIDED: Token in URL Path

**Decision:** Secret is a random token in the URL path (3rd segment), matching Slack's pattern exactly. Stored in `incoming_webhooks` table, encrypted via `encryptionService`. Each webhook gets its own secret tied to a specific channel. Multiple webhooks per channel allowed with unique names for identification.

See Section 5.4 for full DB schema and Section 5.2 for controller validation flow.

---

## 9. Future Enhancements

| Enhancement                             | Priority | Notes                                                                   |
| --------------------------------------- | -------- | ----------------------------------------------------------------------- |
| Rate limiting per webhook               | Medium   | Per-app or per-channel rate limiting beyond global `webhookLimiter`   |
| Audit logging                           | Low      | Track webhook usage (request logs, error counts) beyond creation/revoke |
| Webhook payload transformation          | Low      | Map non-Slack payloads to Xyne message format                           |
| `response_type: "in_channel"` support | Low      | Slack compat for slash command responses                                |

---

## 10. Non-Goals

- Outbound webhooks (already exists via `webhookUrl` on `InstalledApps`)
- Slack Events API compatibility
- Interactive message callbacks
- Slash command handling
- OAuth flow for webhook creation
- Webhook management API (CRUD via REST)
