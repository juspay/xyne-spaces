# External Source Integration System

A modular, platform-agnostic system for integrating external ticketing/messaging platforms (Zoho, Slack, Jira, etc.) into Xyne Spaces.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [How It Works](#how-it-works)
- [App Desk (Xyne Apps → Desk Channels)](#app-desk-xyne-apps--desk-channels)
- [Adding a New Adapter](#adding-a-new-adapter)
- [API Reference](#api-reference)
- [Security](#security)
- [Database Schema](#database-schema)

---

## Overview

The External Source Integration system allows external platforms to send data (tickets, messages, comments) to Xyne Spaces through webhooks. Messages are normalized, authenticated, and synced into Xyne's conversation system.

### Key Features

- **Platform-agnostic**: Core system knows nothing about specific platforms
- **Modular adapters**: Each platform has its own adapter (4 files max)
- **Encrypted credentials**: All API keys/secrets stored encrypted in database
- **Automatic deduplication**: Prevents duplicate messages
- **Thread grouping**: Groups related messages into conversations
- **HTML to plain text**: Converts HTML emails to readable text

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  External Platform (Zoho, Slack, etc.)                      │
└────────────────┬────────────────────────────────────────────┘
                 │ Webhook POST
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  POST /api/external-source-sync/:sourceName/ingest          │
└────────────────┬────────────────────────────────────────────┘
                 │
    ┌────────────▼────────────┐
    │  adapterResolver        │  Find adapter by sourceName
    └────────────┬────────────┘
                 │
    ┌────────────▼────────────┐
    │  authenticate           │  Decrypt credentials, authenticate
    └────────────┬────────────┘
                 │
    ┌────────────▼────────────┐
    │  externalSourceCore     │  Orchestrate processing
    │  ├─ preprocess?         │  (Optional: Fetch extra data)
    │  ├─ transform           │  (Normalize to NormalizedData)
    │  └─ sync                │  (Save to database)
    └─────────────────────────┘
```

### Core Components

#### 1. **Middleware Chain** (`routes/external-source-sync.ts`)
- `adapterResolver`: Loads the correct adapter based on `sourceName`
- `authenticate`: Validates webhook authenticity using adapter's auth logic
- `handler`: Orchestrates the ingestion flow

#### 2. **Adapter Registry** (`core/adapterRegistry.ts`)
- Maintains a map of registered adapters
- Extracts platform from source name (e.g., `zoho-euler` → `zoho`)

#### 3. **External Source Core** (`core/core.ts`)
- Main orchestrator
- Runs: `preprocess → transform → sync`
- Handles deduplication and thread grouping

#### 4. **Database Layer**
- `ExternalSource`: Stores source configuration (name, channelId, encrypted credentials)
- `ExternalMessage`: Tracks messages for deduplication
- `Message`: Actual message content in conversations

---

## How It Works

### 1. Registration (App Startup)

```typescript
// src/integrations/adapters/zoho/index.ts
import { adapterRegistry } from '../../core/adapterRegistry';
import { AdapterFactory } from '../../core/adapterFactory';
import { ZohoAuthenticator } from './authenticator';
import { ZohoTransformer } from './transformer';

export const zohoAdapter = AdapterFactory.create(
  'zoho',
  new ZohoAuthenticator(),
  new ZohoTransformer()
  // Optional: new ZohoFlow() if preprocessing needed
);

adapterRegistry.register('zoho', zohoAdapter);
```

### 2. Webhook Arrives

**Request:**
```http
POST /api/external-source-sync/zoho-euler/ingest
Content-Type: application/json
x-zdesk-jwt: eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "eventType": "Ticket_Thread_Add",
  "payload": {
    "id": "231057000000319397",
    "ticketId": "231057000000341092",
    "content": "<div>User replied to ticket</div>",
    ...
  }
}
```

### 3. Adapter Resolution

```typescript
// Middleware extracts "zoho-euler" from URL
const adapter = adapterRegistry.getAdapter("zoho-euler");
// Returns: zohoAdapter (registered for platform "zoho")
```

### 4. Authentication

```typescript
// Fetch from database
const source = await externalSourceRepository.findByName("zoho-euler");

// Decrypt credentials
const credentialsJson = decrypt(source.credentials);
// credentialsJson = '{"jwkSet": "{...}", "apiKey": "abc123", ...}'

// Authenticate using adapter
const authResult = adapter.authenticate(rawBody, headers, credentialsJson);
// Returns: { authenticated: true } or { authenticated: true, skipProcessing: true }
```

### 5. Data Transformation

```typescript
// ZohoTransformer extracts and normalizes
const result = await adapter.transform(payload);

// Returns NormalizedData:
{
  externalId: "231057000000319397",        // Thread ID
  externalThreadId: "231057000000341092",  // Ticket ID (groups messages)
  author: {
    name: "John Doe",
    email: "john@example.com"
  },
  content: "Subject: Bug Report\n\nUser replied to ticket...",
  metadata: {
    eventType: "Ticket_Thread_Add",
    timestamp: "2025-11-05T10:30:00Z",
    ticketNumber: "12345",
    webUrl: "https://..."
  }
}
```

### 6. Deduplication & Thread Grouping

```typescript
// Check for duplicate by externalId
const existing = await findByExternalId(source.id, normalizedData.externalId);
if (existing) {
  // Already processed - skip or update
  return;
}

// Check if thread exists by externalThreadId
const threadMsg = await findByThreadId(source.id, normalizedData.externalThreadId);
if (threadMsg) {
  // Thread exists - add reply to existing conversation
  conversationService.addMessageToConversation(threadMsg.conversationId, ...);
} else {
  // New thread - create new conversation
  conversationService.createConversation(...);
}
```

### 7. Save to Database

```typescript
// Create ExternalMessage tracking record
await externalMessageRepo.create({
  externalSourceId: source.id,
  externalId: "231057000000319397",
  externalThreadId: "231057000000341092",
  messageId: message.messageId,
  direction: 'INCOMING'
});
```

---

## App Desk (Xyne Apps → Desk Channels)

Installed Xyne Apps with the `desk:write` permission can push tickets into desk channels (`POST /api/apps/tickets/appDeskInbound`) and receive agent replies back through their webhook. The **app↔channel binding** is an `ExternalSource` row with `sourceType='app-desk'` and `externalIdentifier=<installedAppId>` — there is no separate join table.

### Multi-app model

A desk channel of **any** type (EMAIL, DL, SLACK, CALL, SOCIAL_MEDIA, APP) can carry **multiple** connected apps: one `app-desk` source row per (app, channel). A channel stays 1:1 per email/slack source; only app bindings fan out. The app's binding is channel-bound even for DL channels, whose email source is workspace-level.

**Source naming** (`integrations/core/deskSources.ts`):

| Shape | Who wrote it | `externalIdentifier` |
| --- | --- | --- |
| `app-desk-<installedAppId>` | Pre-2026-07-29 rows | **null** — backfilled by migration `20260903090000` |
| `app-desk-<channelId>` | Pre-multi-app APP-channel creation | set |
| `app-desk-<installedAppId>-<channelId>` | Every binding written today, both connect paths | set |

`name` is globally unique — which is why the single-segment shapes structurally
enforced one app per channel, and the two-segment shape is what lifts that.

`resolveAppDeskInstalledAppId(source)` returns `externalIdentifier` when set and
falls back to parsing the name. Only the first shape above needs the fallback, and
note the first two are indistinguishable by shape alone (both single-segment, and
a `channelId` must never be read as an install id) — the column is what separates
them. Once the backfill has run everywhere, the fallback and this ambiguity can go.

### Management API (`routes/app-desk.ts`)

Mounted at `/api/integrations/app-desk`. All three require the caller to be the channel creator or the desk owner (`EmailChannelPreference.ownerUserId`), scoped to the caller's workspace.

| Method & Path | Behavior |
| --- | --- |
| `GET /channels/:channelId/apps` | Lists the channel's app bindings: `{ success: true, apps: [{ sourceId, installedAppId, appName, isActive, createdAt }] }`. `appName` is `null` when the backing install is gone. |
| `POST /channels/:channelId/apps` | Connects an app. Body `{ installedAppId }`. Validates the install is in the caller's workspace and holds `desk:write` (APPROVED or PENDINGDELETE), else `404`/`403`. Active duplicate → `409`; an inactive binding is reactivated in place (`200`), otherwise the source row is created (`201`). |
| `DELETE /channels/:channelId/apps/:installedAppId` | Soft disconnect: sets `isActive=false`, never deletes the row (preserves `ExternalMessage` history, so threads and reply routing survive a reconnect). No active binding → `404`. |

Both connect paths — this API and APP-channel creation — go through one repository method: `ExternalSourceRepository.connectAppToChannel({ channelId, installedAppId, workspaceId, displayName })` (returns `{ source, outcome: 'created' | 'reactivated' | 'already-connected' }`). Both now produce the two-segment name; APP-channel creation used to override it with the old `app-desk-<channelId>` shape, which bought nothing (no code reads these rows by name) and kept minting fresh single-segment names that were shape-ambiguous with the pre-2026-07-29 rows.

### Inbound authorization change

`appDeskInbound` no longer requires `deskType === APP`; it accepts any desk channel. The channel-wide gate is replaced by a **per-app binding check**: the caller's `installedAppId` must have an `app-desk` source on the channel — no binding → `403 APP_NOT_CONNECTED` (this closes the pre-existing gap where any `desk:write` app could push into any APP desk), inactive binding → `409 DESK_DISCONNECTED`. Note the permission itself is still enforced per request (`requirePermission('desk:write')` re-reads grants on every call) — the binding is about *which channel* the app may write to, not whether it may write at all.

### Orphan handling

When an install's `desk:write` grant is revoked (`activateInstalledPermissions` or app update via `syncFromAppApproved`), its `app-desk` sources are set `isActive=false` (hook: `AppPermissionRepository.deactivateAppDeskSourcesIfDeskWriteLost`), so the UI shows the desk as disconnected. There is no app-uninstall flow to hook — none exists in the API surface today; inbound remains protected per call by `requirePermission`.

### History export API (app implements, Xyne calls)

The desk fetch button can pull history from each connected app in addition to the mailbox. The app exposes one endpoint; Xyne paginates it with the same HMAC secret used for outbound webhooks.

**An app does not have to match Xyne's shape.** Both how the endpoint paginates and how its response is read are part of the per-install config, so an app with an existing export API is configured rather than changed.

**The endpoint is configured per install, not derived.** A workspace admin sets it on Apps → Installed → Edit → History fetch, which stores a JSON config in `installed_apps.fetchConfig` (`AppFetchConfigSchema` in `apps/core/appFetchConfig.ts`): URL, method, headers, encoding, body, timeout, pagination mode and response mapping. An install with no config cannot be fetched from — there is no default endpoint.

The config is deliberately the **same shape as an automation's `TRIGGER_WEBHOOK` step**, and the dashboard reuses that step's form. Two fields are narrowed, because this is a read rather than an arbitrary API call:

- **Method is `POST` (default) or `GET` only.** `PUT`, `PATCH` and `DELETE` mean "change this resource", which an export never does — and a `DELETE` aimed at a mistyped URL would issue a signed destructive request once per page.
- **No `responseSchema`.** That field declares a shape for *later automation steps* to read; nothing runs downstream of a fetch. Reading the app's response is the job of `response` below, which is a different thing: a mapping Xyne applies, not a shape the author declares for someone else.

Two are added, because a fetch walks pages of a response where an automation reads one once: **`pagination`** (with `pageSize`) and **`response`**. Both are covered under [Response](#response).

**One config serves every channel.** An app installed once is typically connected to several desk channels. Rather than holding a config per channel, Xyne sends the channel in the request and the app branches on it.

#### Request

The body is a **template string** in which `{{...}}` references are substituted, exactly as in an automation's webhook body. It is sent as the request body for `POST`; a `GET` sends no body, so its parameters go in the URL, which is templated the same way. A typical body:

```json
{
  "startDate": "{{fetch.startDate}}",
  "endDate": "{{fetch.endDate}}",
  "cursor": "{{fetch.cursor}}",
  "limit": 200,
  "channelId": "{{channel.id}}",
  "sourceId": "{{source.id}}",
  "installedAppId": "{{installedApp.id}}"
}
```

| Reference | Meaning |
| --- | --- |
| `{{fetch.startDate}}` / `{{fetch.endDate}}` | Window bounds, ISO 8601 |
| `{{fetch.cursor}}` | Page cursor — **cursor pagination only**; empty string on the first page |
| `{{fetch.offset}}` / `{{fetch.limit}}` | Rows already requested, and the page size — **offset pagination only** |
| `{{channel.id}}` / `{{channel.name}}` | Desk channel being fetched into |
| `{{source.id}}` | This app↔channel connection (`external_sources.id`) |
| `{{installedApp.id}}` / `{{app.id}}` / `{{workspace.id}}` | Identity of the install, app and workspace |

The cursor and offset variables are mutually exclusive — the config screen only offers the ones live in the selected mode, because the others always render empty or zero.

Two things matter to an implementer:

- **Substitution is textual.** The template is a string, so quoting is the author's: `"limit": 200` sends a number, `"limit": "200"` sends a string.
- **An unresolved reference renders empty, it does not vanish.** The first request sends `"cursor": ""`, not an absent key, so **an app must treat an empty cursor as "start from the beginning"**. Same for a `GET`: the query carries `cursor=`.

Headers may also contain references. Values of sensitive headers (`Authorization` and friends, plus anything named in `secretHeaders`) are encrypted at rest with the same helpers automations use, and are served back to the config screen redacted.

#### Authentication

Headers on every request: `X-Xyne-Timestamp` (epoch seconds), `X-Xyne-Request-Signature` (hex HMAC-SHA256), `X-Source: XyneSpaces`.

The signed string is:

```
`${timestamp}\n${METHOD}\n${pathWithQuery}\n${sha256Hex(rawBody)}`
```

**The body hash is part of the canonical string** — the last line, and the SHA-256 of the empty string for a bodyless request (every `GET`). It binds the payload to the signature: the body carries the channel id and the date window, so signing only the path would let a captured request be replayed against a different channel inside the skew window. `pathWithQuery` is signed exactly as sent, so a `GET` must be verified against the query string as received. This scheme is separate from the body-only `X-Xyne-Signature` webhook scheme; the shared secret is the same. Verify with a ±5 min skew window.

Xyne applies its own headers **last**, so a stored header can never shadow the signature, `X-Source` or the content type. The signing secret itself is never part of the config: it is read from the app server-side at request time.

#### Testing a config

`POST /api/apps/installed/:installedAppId/fetch-config/test` (the **Test fetch** button) sends one real signed request over a recent 24-hour window and **ingests nothing**. It reports the rendered request, the status, and whether the response can be read through the configured mapping — a `200` in the wrong shape is reported as a failure, since it would fail the same way inside the worker. Pass a `config` in the body to test unsaved form state, and an optional `channelId` to render `{{channel.*}}` and `{{source.id}}` for a real desk.

#### Response

An app returning Xyne's own shape needs no mapping at all:

```json
{ "messages": [ { "externalId", "externalThreadId", "subject", "body",
                  "sender": { "email", "name" }, "recipients", "sentAt" } ],
  "nextCursor": "…" }
```

Anything else is described by `response` in the config (`AppFetchResponseMappingSchema`), which is applied before any of the ingest logic sees a message:

| Setting | Meaning |
| --- | --- |
| `messagesPath` | Dot path to the message array. **Empty means the response is a bare array.** |
| `nextCursorPath` | Dot path to the continuation token. Cursor pagination only. |
| `fields.*` | Where each Xyne field lives on the app's item. Dot paths, so `additionalFormFields.messageCreatedAt` is fine. |
| `idFields` | Paths combined (joined with `\|`) into the deduplication id. Empty uses `fields.externalId` alone. |

Only **`externalId` and `sentAt`** are mandatory per message; everything else degrades (a missing sender falls back to the desk owner, a missing subject to `(no subject)`). A mapping pointing at a field the app does not send fails with that path named, so the **Test fetch** button reports `message 3 has no timestamp at "additionalFormFields.messageCreatedAt"` rather than a generic shape error. `sampleMessage` in the test result is the **mapped** message, which is where a wrong path shows up.

##### Why `idFields` exists

Xyne deduplicates on `(externalSourceId, externalId)`. An app's own id is not always unique on its own: an auto-reply or canned-option message commonly carries its **template** id, so the same value legitimately appears on every ticket that used it. Left alone, the first occurrence would be ingested and every later copy discarded as a duplicate — silently, and in proportion to how many tickets use canned replies.

Listing the jointly-unique fields fixes this without asking the app to change its ids. For an API whose rows are unique on thread + id + timestamp:

```
idFields: ["threadId", "externalId", "additionalFormFields.messageCreatedAt"]
```

##### Pagination

`pagination` selects how Xyne walks pages. Both modes are sequential — page N+1 is only requested once page N is persisted.

**`cursor`** (default) — the app returns an opaque token at `nextCursorPath` and Xyne echoes it back verbatim as `{{fetch.cursor}}`. Its absence marks the terminal page. Pages must be oldest-first and the cursor must strictly advance (never revisit older items). Mid-export arrivals at the old end must *not* be included — the `startDate..endDate` window is fixed.

**`offset`** — for apps with no continuation token. Xyne sends `{{fetch.offset}}` and `{{fetch.limit}}`, then advances the offset by the configured `pageSize` itself. **An empty page is the only end-of-data signal**, so the app must return an empty array past the end rather than repeating the last page. `pageSize` must match the limit the app is actually sent, since it is also the increment. Note that some apps count `limit` in *threads* rather than messages; that is fine — the offset advances in whatever unit the app paginates by, and Xyne only cares that pages are disjoint and eventually empty.

Either way the run also stops on the page cap, the wall-clock budget, or a throttle it cannot wait out; progress is parked (the cursor, or the offset) and the next Fetch resumes from it.

##### Worked example: an existing offset-paginated API

An app already exposes `GET /issues?startDate=&endDate=&limit=&offset=` behind a bearer token, returning a **bare array** whose items use their own field names and nest the timestamp. No change on their side; the config absorbs all of it:

```
Method      GET
URL         https://app.example.com/issues?startDate={{fetch.startDate}}&endDate={{fetch.endDate}}&limit={{fetch.limit}}&offset={{fetch.offset}}
Auth        Bearer  (stored encrypted, redacted in the UI; Xyne's signature is sent as well)
Pagination  offset,  pageSize 50

response.messagesPath   ""                       (bare array)
response.fields.externalId        externalId
response.fields.externalThreadId  threadId
response.fields.sentAt            additionalFormFields.messageCreatedAt
response.fields.senderName        senderName
response.fields.subject           subject
response.fields.body              body
response.idFields  ["threadId", "externalId", "additionalFormFields.messageCreatedAt"]
```

Points worth copying:

- `limit` there counts **issues**, not messages, so a `pageSize` of 50 returns however many messages those 50 issues contain. Harmless — the offset advances in the app's own unit.
- The app's `externalId` repeats across tickets for canned replies, so `idFields` carries the composite key. Without it roughly a third of messages would be discarded as duplicates.
- The app has no sender email; that field is simply unmapped and the desk owner is used instead.

#### Throttling

- Pages are requested **back-to-back with no client-side delay** — page N+1 is issued as soon as page N is persisted, so a fast app will see a sustained serial request stream. To slow Xyne down, answer `429` (or `503`) with a `Retry-After` header (delta-seconds or HTTP-date); Xyne honors it, backs off in place, and continues the same export — up to 5 backoff-and-retry rounds per page (6 requests in total; a 6th throttled response ends the run), falling back to exponential backoff from 1s when the header is absent. Each retry is **re-signed**, so the `X-Xyne-Timestamp` skew window applies to the retry, not the original attempt. A `Retry-After` longer than the run's remaining budget is not slept through: the export stops cleanly, keeps what it ingested, and resumes from the same page on the next Fetch. Do not answer `429` without `Retry-After` if you need a specific pace — the exponential fallback may be shorter than you want.
Fetch requires `ENABLE_EMAIL_FETCH_WORKER=true` in the backend; otherwise the route returns `409` without calling the app.

---

## Adding a New Adapter

### Example: Adding Slack Integration

#### Step 1: Create Adapter Directory

```
src/integrations/adapters/slack/
├── authenticator.ts
├── transformer.ts
├── types.ts
└── index.ts
```

#### Step 2: Define Types (`types.ts`)

```typescript
export interface SlackWebhookPayload {
  type: string;
  event: {
    type: string;
    channel: string;
    user: string;
    text: string;
    ts: string;
    thread_ts?: string;
  };
}

export enum SlackEventType {
  MESSAGE = 'message',
  APP_MENTION = 'app_mention'
}
```

#### Step 3: Create Authenticator (`authenticator.ts`)

```typescript
import { BaseAuthenticator } from '../../core/baseAuthenticator';
import { AuthResult } from '../../core/types';
import crypto from 'crypto';

export class SlackAuthenticator extends BaseAuthenticator {
  authenticate(
    rawBody: string,
    headers: Record<string, string | string[]>,
    credentialsJson: string
  ): AuthResult {
    try {
      // Parse credentials
      const credentials = JSON.parse(credentialsJson);
      const { signingSecret } = credentials;

      // Get Slack signature
      const slackSignature = headers['x-slack-signature'] as string;
      const timestamp = headers['x-slack-request-timestamp'] as string;

      if (!slackSignature || !timestamp) {
        return { authenticated: false };
      }

      // Verify timestamp (prevent replay attacks)
      const currentTime = Math.floor(Date.now() / 1000);
      if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
        return { authenticated: false };
      }

      // Calculate HMAC
      const sigBaseString = `v0:${timestamp}:${rawBody}`;
      const hmac = crypto
        .createHmac('sha256', signingSecret)
        .update(sigBaseString)
        .digest('hex');
      const computedSignature = `v0=${hmac}`;

      // Compare signatures
      const authenticated = crypto.timingSafeEqual(
        Buffer.from(slackSignature),
        Buffer.from(computedSignature)
      );

      return { authenticated };

    } catch (error) {
      return { authenticated: false };
    }
  }
}
```

#### Step 4: Create Transformer (`transformer.ts`)

```typescript
import { BaseTransformer } from '../../core/baseTransformer';
import { NormalizedData, ParseResult } from '../../core/types';
import { SlackWebhookPayload } from './types';

export class SlackTransformer extends BaseTransformer<SlackWebhookPayload, NormalizedData> {
  async transform(payload: SlackWebhookPayload): Promise<ParseResult<NormalizedData>> {
    try {
      const { event } = payload;

      const normalized: NormalizedData = {
        // Message ID
        externalId: event.ts,

        // Thread ID (groups messages together)
        externalThreadId: event.thread_ts || event.ts,

        // Parent message (for replies)
        externalParentId: event.thread_ts ? event.ts : undefined,

        author: {
          name: event.user,
          email: undefined,
          externalId: event.user
        },

        content: event.text,

        metadata: {
          eventType: event.type,
          timestamp: new Date(parseFloat(event.ts) * 1000),
          channel: event.channel
        }
      };

      return { success: true, data: normalized };

    } catch (error) {
      return {
        success: false,
        error: `Transform error: ${error instanceof Error ? error.message : 'Unknown'}`
      };
    }
  }
}
```

#### Step 5: Register Adapter (`index.ts`)

```typescript
import { adapterRegistry } from '../../core/adapterRegistry';
import { AdapterFactory } from '../../core/adapterFactory';
import { SlackAuthenticator } from './authenticator';
import { SlackTransformer } from './transformer';

export const slackAdapter = AdapterFactory.create(
  'slack',
  new SlackAuthenticator(),
  new SlackTransformer()
);

adapterRegistry.register('slack', slackAdapter);
```

#### Step 6: Import in Main Index (`integrations/index.ts`)

```typescript
// Import adapters (triggers auto-registration)
import './adapters/zoho';
import './adapters/slack';  // Add this line
```

#### Step 7: Configure Database

```sql
-- Encrypt credentials using scripts/encrypt-credentials.js
-- Insert into database
INSERT INTO external_sources (id, name, "sourceType", "displayName", "channelId", credentials, "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'slack-general',
  'slack',
  'Slack (General)',
  'YOUR_CHANNEL_ID',
  'ENCRYPTED_CREDENTIALS_HERE',
  true,
  NOW(),
  NOW()
);
```

#### Step 8: Test

```bash
# Send test webhook
curl -X POST http://localhost:3000/api/external-source-sync/slack-general/ingest \
  -H "Content-Type: application/json" \
  -H "x-slack-signature: v0=abc123..." \
  -H "x-slack-request-timestamp: 1234567890" \
  -d '{
    "type": "event_callback",
    "event": {
      "type": "message",
      "channel": "C12345",
      "user": "U67890",
      "text": "Hello from Slack!",
      "ts": "1234567890.123456"
    }
  }'
```

**That's it!** No changes to core, middleware, or routes needed. 🎉

---

## API Reference

### Core Interfaces

#### `AuthResult`
```typescript
interface AuthResult {
  authenticated: boolean;
  skipProcessing?: boolean;  // Set to true for test webhooks
  reason?: string;           // Optional reason (e.g., "test_webhook")
}
```

#### `NormalizedData`
```typescript
interface NormalizedData {
  externalId: string;           // Unique message ID
  externalThreadId: string;     // Thread/ticket ID (groups messages)
  externalParentId?: string;    // Parent message ID (for replies)

  author: {
    name: string;
    email?: string;
    externalId?: string;
  };

  content: string;              // Message body (plain text or simple HTML)

  attachments?: Array<{
    fileName: string;
    fileUrl: string;
    mimeType?: string;
    size?: number;
  }>;

  metadata: {
    eventType: string;          // Platform-specific event type
    timestamp: Date;
    [key: string]: any;         // Platform-specific fields
  };
}
```

#### `ExternalSourceAdapter`
```typescript
interface ExternalSourceAdapter {
  name: string;

  authenticate(
    rawBody: string,
    headers: Record<string, string | string[]>,
    credentialsJson: string
  ): AuthResult;

  preprocess?(rawPayload: unknown): Promise<unknown>;

  transform(payload: unknown): Promise<ParseResult<NormalizedData>>;
}
```

### Base Classes

#### `BaseAuthenticator`
```typescript
abstract class BaseAuthenticator {
  abstract authenticate(
    rawBody: string,
    headers: Record<string, string | string[]>,
    credentialsJson: string
  ): AuthResult;
}
```

#### `BaseTransformer<TRaw, TNormalized>`
```typescript
abstract class BaseTransformer<TRaw, TNormalized> {
  abstract transform(rawPayload: TRaw): Promise<ParseResult<TNormalized>>;
}
```

#### `BaseFlow` (Optional)
```typescript
abstract class BaseFlow {
  abstract preprocess(rawPayload: unknown): Promise<unknown>;
}
```

---

## Security

### Credential Storage

All external source credentials are **encrypted at rest** in the database using AES-256-CBC:

1. **Encryption**: Use `scripts/encrypt-credentials.js` to encrypt credentials
2. **Storage**: Store encrypted string in `external_sources.credentials` column
3. **Decryption**: Automatically decrypted in validator middleware
4. **Format**: `"IV:ciphertext"` (hex-encoded)

#### Encrypting Credentials

```bash
# 1. Set ENCRYPTION_KEY in .env
ENCRYPTION_KEY=<32-byte-hex-key>

# 2. Set platform credentials in .env
ZOHO_EULER_JWK_SET='{"keys":[...]}'
ZOHO_EULER_API_KEY=abc123

# 3. Run encryption script
node scripts/encrypt-credentials.js

# Output:
# Encrypted: a1b2c3d4...e5f6:9g8h7i6j...
```

### Authentication Methods

#### Zoho (JWT RS256)
- Uses JWK Sets for RSA public key validation
- Verifies `x-zdesk-jwt` header
- Detects test webhooks (`{"{}":""}`)

#### Slack (HMAC-SHA256)
- Uses signing secret
- Verifies `x-slack-signature` header
- Timestamp validation (prevents replay attacks)

---

## Database Schema

### `external_sources`
Stores external source configuration:

```sql
CREATE TABLE "external_sources" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT UNIQUE NOT NULL,           -- "zoho-euler", "slack-general"
  "sourceType" TEXT NOT NULL,            -- "zoho", "slack", "jira"
  "displayName" TEXT NOT NULL,           -- "Zoho (Euler Team)"
  "channelId" TEXT NOT NULL,             -- Target Xyne channel
  "credentials" TEXT NOT NULL,           -- Encrypted credentials (IV:ciphertext)
  "isActive" BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);
```

### `external_messages`
Tracks messages for deduplication and thread grouping:

```sql
CREATE TABLE "external_messages" (
  "id" TEXT PRIMARY KEY,
  "externalSourceId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,            -- Message ID from external system
  "externalThreadId" TEXT NOT NULL,      -- Thread/Ticket ID
  "messageId" TEXT NOT NULL,             -- Link to Xyne message
  "direction" TEXT NOT NULL,             -- "INCOMING" or "OUTGOING"
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW(),

  UNIQUE("externalSourceId", "externalId")
);

CREATE INDEX ON "external_messages"("externalSourceId", "externalThreadId");
CREATE INDEX ON "external_messages"("messageId");
```

---

## Advanced Features

### Optional Preprocessing (Flow)

If you need to fetch additional data before transformation:

```typescript
// adapters/jira/flow.ts
import { BaseFlow } from '../../core/baseFlow';

export class JiraFlow extends BaseFlow {
  async preprocess(rawPayload: any): Promise<any> {
    // Fetch additional ticket data from Jira API
    const issueKey = rawPayload.issue.key;
    const response = await fetch(`https://api.jira.com/issue/${issueKey}`);
    const fullIssue = await response.json();

    return {
      ...rawPayload,
      enrichedData: fullIssue
    };
  }
}

// adapters/jira/index.ts
export const jiraAdapter = AdapterFactory.create(
  'jira',
  new JiraAuthenticator(),
  new JiraTransformer(),
  new JiraFlow()  // 4th parameter is optional
);
```

### Test Webhook Detection

```typescript
authenticate(rawBody: string, headers, credentialsJson): AuthResult {
  // Detect test webhook
  if (rawBody === '{"test": true}') {
    return {
      authenticated: true,
      skipProcessing: true,
      reason: 'test_webhook'
    };
  }

  // ... normal authentication
  return { authenticated: true };
}
```

### HTML to Plain Text

For email-based platforms (like Zoho), HTML content is converted to plain text:

```typescript
import { convert } from 'html-to-text';

private htmlToPlainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' }
    ]
  });
}
```

---

## Troubleshooting

### Common Issues

#### 1. Authentication Fails
- Check encrypted credentials in database
- Verify `ENCRYPTION_KEY` is correct
- Check webhook signature/JWT is valid
- Review adapter's `authenticate()` logic

#### 2. Duplicate Messages
- Ensure `externalId` is unique per message
- Check `findByExternalId()` is working
- Verify database unique constraint exists

#### 3. Wrong Thread Grouping
- Ensure `externalThreadId` is consistent for related messages
- For Zoho: Use `payload.ticketId`, not `payload.id` for thread replies
- Check `findByThreadId()` logic

#### 4. Content Too Long Error
- Ensure content is truncated to 9000 characters
- Check `formatContent()` includes truncation logic
- Verify HTML is converted to plain text

### Debug Logging

Enable debug logs in the core:

```typescript
// core/core.ts
logger.info(`Looking for existing thread: ${normalizedData.externalThreadId}`);
logger.info(`Found existing conversation: ${conversation.conversationId}`);
```

---

## File Structure

```
src/integrations/
├── adapters/
│   ├── zoho/
│   │   ├── authenticator.ts    # JWT RS256 validation
│   │   ├── transformer.ts      # Normalize Zoho payload
│   │   ├── types.ts            # Zoho-specific types
│   │   └── index.ts            # Register adapter
│   └── slack/                  # (Future)
│
├── core/
│   ├── baseAuthenticator.ts    # Abstract auth class
│   ├── baseTransformer.ts      # Abstract transform class
│   ├── baseFlow.ts             # Abstract preprocess class
│   ├── adapterFactory.ts       # Creates adapters
│   ├── adapterRegistry.ts      # Stores registered adapters
│   ├── authenticate.ts         # Auth middleware
│   ├── core.ts                 # Main orchestrator
│   ├── types.ts                # Core interfaces
│   └── errors.ts               # Custom errors
│
├── middleware/
│   └── adapterResolver.ts      # Resolve adapter from sourceName
│
├── routes/
│   └── external-source-sync.ts # Webhook endpoint
│
└── index.ts                    # Module exports
```

---

## Best Practices

1. **Always use TypeScript types** for payload structures
2. **Test authentication** with real webhook signatures
3. **Handle edge cases** in transformers (missing fields, different formats)
4. **Log extensively** during development
5. **Use meaningful externalIds** that are truly unique
6. **Group related messages** using consistent externalThreadId
7. **Truncate long content** before saving to database
8. **Convert HTML to plain text** for better readability
9. **Skip test webhooks** using `skipProcessing` flag
10. **Encrypt all credentials** - never store in plain text

---

## Contributing

When adding a new adapter:

1. Create adapter directory under `adapters/`
2. Implement authenticator, transformer, and types
3. Register in `index.ts`
4. Add database entry with encrypted credentials
5. Update this README with platform-specific notes
6. Add tests for authentication and transformation

---

## License

Internal use only - Xyne Spaces Backend
