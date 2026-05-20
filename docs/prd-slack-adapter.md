# PRD: Slack-Compatible API Adapter Layer

**Author**: Ameer Noufil
**Status**: Final
**Date**: 2026-05-04
**Scope**: Backend — new API surface at `/api/apps/slack/*`

---

## 1. Problem Statement

Xyne has an Apps API at `/api/apps/*` with a custom type system (Xyne IDs, `PaginatedResponse<T>`, Xyne-native field names). A significant share of existing chatops tooling — Slack bots, SDKs (`@slack/web-api`, Bolt for Python/JS), and internal automations — are already built against the Slack Web API contract.

Today, migrating a Slack bot to Xyne requires rewriting every API call and response handler. This is a barrier to adoption.

## 2. Goal

Create a **Slack-compatible API surface** at `/api/apps/slack/*` so that existing Slack bots can work with Xyne by changing **only the base URL and token**. Same endpoint paths, same request parameters, same response shapes as Slack's Web API.

**Non-goal**: Full Slack API parity. Only endpoints that have Xyne equivalents are in scope.

## 3. Architecture

### 3.1 Pattern: Adapter + Bidirectional Transformer

```
Slack-format Request
    ↓
[Platform Router]       /api/apps/slack/chat.postMessage
    ↓
[Auth Adapter]          Reuse authenticateApp (same JWT Bearer token)
    ↓
[Request Transformer]   Slack request fields → Xyne request fields
    ↓
[Xyne Core Logic]       Existing controllers/core utils (UNCHANGED)
    ↓
[Response Transformer]  Xyne response → Slack response envelope {ok, ...}
    ↓
Slack-format Response   { ok: true, channel: "...", ts: "...", message: {...} }
```

**Key principles**:

- Adapter layer is a translation skin. Zero changes to core business logic.
- Adapter calls core utility functions directly (no HTTP hop to `/api/apps/*`).
- All errors wrapped in Slack's `{ ok: false, error: "code" }` envelope (HTTP 200).

### 3.2 Future Platform Extensibility

The architecture is designed so adding Discord, Teams, or any other platform = just a new adapter + transformer pair:

```
/api/apps/slack/*    → SlackAdapter    + SlackTransformers    → Xyne Core
/api/apps/discord/*  → DiscordAdapter  + DiscordTransformers  → Xyne Core  (future)
/api/apps/teams/*    → TeamsAdapter    + TeamsTransformers    → Xyne Core  (future)
```

Each platform implements the same generic interfaces. Xyne core stays untouched.

### 3.3 Directory Structure

```
backend/src/apps/
  platform-adapters/
    types.ts                        # IPlatformAdapter, TransformContext, PlatformAdapterRegistry
    slack/
      index.ts                      # SlackAdapter implementation
      routes.ts                     # Express router — thin wiring only (route defs + middleware)
      controller.ts                 # SlackController class — all handler logic + Zod schemas
      middleware.ts                 # slackAuthenticateApp, slackRawBodyAuthenticateApp, slackChannelValidation
      error-transformer.ts          # transformSlackError + wrapSlackHandler error boundary
      types.ts                      # Slack-specific request/response type definitions
      request-transformers/
        chat.ts                     # chat.postMessage, chat.update → Xyne format
        conversations.ts            # conversations.list, .history, .replies → Xyne format
        users.ts                    # users.info, users.lookupByEmail → Xyne format
        files.ts                    # files.upload → Xyne format
      response-transformers/
        chat.ts                     # ChatActionResponse → {ok, channel, ts, message}
        conversations.ts            # ChannelListResponse, ChannelHistoryResponse → Slack format
        users.ts                    # UserResponse → Slack user object
        files.ts                    # FileUploadResponse → Slack format
        usergroups.ts               # UserGroupResponse → Slack usergroup objects
    discord/                        # Future
    teams/                          # Future
```

### 3.4 Mount Point

In `backend/src/apps/routes/apps.ts`, the adapter is registered via `PlatformAdapterRegistry` and mounted alongside existing sub-routes:

```typescript
import { PlatformAdapterRegistry } from '../platform-adapters/types';
import { SlackAdapter } from '../platform-adapters/slack';

const platformRegistry = new PlatformAdapterRegistry();
platformRegistry.register(new SlackAdapter());

// Existing sub-routes under /api/apps
router.use('/channel', authenticateApp, channelRoutes);
router.use('/chat', authenticateApp, chatRoutes);
// ...

// Platform adapter routes (Slack-compatible API surface)
platformRegistry.mountAll(router);
```

**Note**: `authenticateApp` is NOT passed at mount time. The Slack adapter handles its own auth via `slackAuthenticateApp` middleware, which wraps `authenticateApp` to convert HTTP error responses into Slack's `{ok: false}` envelope format (see §6).

This keeps everything under the `/api/apps/*` namespace. Slack adapter lives at `/api/apps/slack/*`.

---

## 4. Adapter Contracts

The platform-level contract is intentionally small. Adapters share a registry and a base transform context; request, response, and error transformers are plain typed functions in each adapter folder. This keeps Slack as the reference implementation without adding object wrappers that are not used polymorphically.

```typescript
import { Router, RequestHandler } from 'express';

export interface TransformContext {
  userId: string;
  appId: string;
  workspaceId?: string;
}

export interface IPlatformAdapter {
  readonly platformName: string;
  getRouter(): Router;
}

export class PlatformAdapterRegistry {
  private adapters = new Map<string, IPlatformAdapter>();

  register(adapter: IPlatformAdapter): void {
    this.adapters.set(adapter.platformName, adapter);
  }

  mountAll(parentRouter: Router, ...middleware: RequestHandler[]): void {
    for (const [name, adapter] of this.adapters) {
      parentRouter.use(`/${name}`, ...middleware, adapter.getRouter());
    }
  }
}
```

**Implementation notes**:

- Slack transformer modules export pure functions such as `transformPostMessage()`, `transformHistoryResponse()`, and `transformSlackError()`.
- `transformSlackError()` takes raw `unknown` catch-block errors and returns Slack's `{ ok: false, error }` envelope.
- `PlatformAdapterRegistry` lives in `types.ts` alongside `TransformContext` and `IPlatformAdapter`.

---

## 5. Endpoint Mapping

### 5.1 In Scope — All Implemented Endpoints

Slack adapter endpoints support Slack's documented HTTP method. Read/list/info methods that Slack documents as **GET** also expose equivalent **POST** routes because some Slack client packages only issue POST calls. GET routes read parameters from `req.query`; equivalent POST routes read the same parameters from `req.body`. Write/upload methods remain POST-only.

| #  | Slack Method                     | Slack Path                                            | Xyne Core Function                            |
| -- | -------------------------------- | ----------------------------------------------------- | --------------------------------------------- |
| 1  | `auth.test`                   | `GET/POST /api/apps/slack/auth.test`                | JWT auth context + user/workspace lookup      |
| 2  | `chat.postMessage`             | `POST /api/apps/slack/chat.postMessage`             | `findOrCreateConversation()`                |
| 3  | `chat.update`                  | `POST /api/apps/slack/chat.update`                  | `updateConversation()`                      |
| 4  | `conversations.history`        | `GET/POST /api/apps/slack/conversations.history`    | `getChannelHistory()`                       |
| 5  | `conversations.replies`        | `GET/POST /api/apps/slack/conversations.replies`    | `getConversationReplies()`                  |
| 6  | `conversations.info`           | `GET/POST /api/apps/slack/conversations.info`       | `repositories.channels.findById()`          |
| 7  | `conversations.list`           | `GET/POST /api/apps/slack/conversations.list`       | `repositories.channels.findManyPaginated()` |
| 8  | `conversations.open`           | `POST /api/apps/slack/conversations.open`           | `unifiedDMService` / `findOrCreateDMChannel()` |
| 9  | `users.info`                   | `GET/POST /api/apps/slack/users.info`               | `getUserData()`                             |
| 10 | `users.lookupByEmail`          | `GET/POST /api/apps/slack/users.lookupByEmail`      | `repositories.users.findByEmailCaseInsensitive()` |
| 11 | `files.upload`                 | `POST /api/apps/slack/files.upload`                 | `ingestAttachment()`                        |
| 12 | `usergroups.list`              | `GET/POST /api/apps/slack/usergroups.list`          | `getAllUserGroups()`                        |
| 13 | `files.getUploadURLExternal`   | `POST /api/apps/slack/files.getUploadURLExternal`   | Redis state +`uploadFiles()` (V2 step 1)    |
| 14 | _(binary upload)_              | `POST /api/apps/slack/_upload/:fileId`              | `uploadFiles()` (V2 step 2)                 |
| 15 | `files.completeUploadExternal` | `POST /api/apps/slack/files.completeUploadExternal` | `findOrCreateConversation()` (V2 step 3)    |

### 5.2 Xyne Endpoints with NO Slack Equivalent (Excluded)

| Xyne Endpoint                          | Reason                                                              |
| -------------------------------------- | ------------------------------------------------------------------- |
| `POST /api/apps/chat/agentProgress`  | Xyne-specific ephemeral agent progress signal. No Slack equivalent. |
| `POST /api/apps/ticket/createTicket` | Xyne ticket system. No Slack equivalent.                            |
| `POST /api/apps/ticket/updateTicket` | Xyne ticket system. No Slack equivalent.                            |
| `GET /api/apps/email/emailReplies`   | Xyne email threading. No Slack equivalent.                          |
| `POST /api/apps/chat/action`         | Xyne-specific interactivity dispatch (user auth, not app auth).     |
| `POST /api/apps/flow/action`         | Xyne-specific Flow UI execution.                                    |

### 5.3 Slack Methods with NO Xyne Equivalent (Excluded)

| Slack Method                                                   | Reason                                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `chat.delete`                                                | Xyne has no message deletion API.                                                       |
| `reactions.add` / `reactions.remove`                       | Xyne reactions use different auth path (user auth via `/api/messages`, not app auth). |
| `users.list`                                                 | No Xyne apps API for listing all users.                                                 |
| `files.list`                                                 | No Xyne equivalent.                                                                     |
| `chat.postEphemeral`                                         | No Xyne equivalent.                                                                     |
| `conversations.create` / `archive` / `invite` / `kick` | Not in Xyne apps API.                                                                   |
| Events API / Socket Mode                                       | Xyne has webhook event delivery (separate concern).                                     |

---

## 6. Authentication

### Implemented: Xyne JWT with Slack Error Wrapping

The existing `authenticateApp` middleware is reused but **wrapped** in `slackAuthenticateApp` (in `middleware.ts`) to convert auth errors into Slack's `{ok: false}` envelope:

1. `slackAuthenticateApp` intercepts `res.status()` and `res.json()` before calling `authenticateApp`
2. If `authenticateApp` responds with HTTP 4xx/5xx, the wrapper converts it to `HTTP 200 + {ok: false, error: "not_authed"}` (or `"internal_error"` for 5xx)
3. On success, `userId` and `appId` are saved to `req._slackAuth`; `getSlackAuthContext()` returns these plus `workspaceId` from `req.user?.workspaceId`
4. A variant `slackRawBodyAuthenticateApp` handles the binary file upload endpoint (`_upload/:fileId`) where `req.body` is a raw `Buffer` — it temporarily replaces the body for auth, then restores it

**JWT flow** (unchanged from core `authenticateApp`):

1. Extracts JWT from `Authorization: Bearer <token>` header
2. Decodes (unverified) to get `appId` + `userId` for DB lookup
3. Looks up installed app in DB → gets signing secret
4. Verifies JWT with HS256

**What this means for bot developers**: Bots use their existing Xyne-issued JWT token. Only the base URL changes from `/api/apps/` to `/api/apps/slack/`. Token format is JWT, not Slack's `xoxb-*`.

### Implemented: `auth.test`

`GET/POST /api/apps/slack/auth.test` validates the Xyne app JWT and returns Slack-style identity fields: `{ ok, url, team, user, team_id, user_id, bot_id, is_enterprise_install }`.

### Future: Token Exchange

Allow Slack-style token alias mapping to Xyne JWT. Token format remains the main non-parity point: Xyne uses app JWTs, not Slack `xoxb-*` tokens.

---

## 7. Error Handling

### Slack Error Convention

Slack **always returns HTTP 200** with `{ ok: false, error: "error_code" }` for API errors. This differs from Xyne which uses HTTP status codes. The adapter must catch all errors and return HTTP 200.

### Error Mapping Table

| Xyne HTTP Status | Xyne Error Code         | Slack Error String                         |
| ---------------- | ----------------------- | ------------------------------------------ |
| 400              | `VALIDATION_ERROR`    | `invalid_arguments`                      |
| 401              | `Unauthorized`        | `not_authed`                             |
| 401              | (invalid JWT)           | `invalid_auth`                           |
| 403              | (access denied)         | `not_in_channel`                         |
| 404              | `CHANNEL_NOT_FOUND`   | `channel_not_found`                      |
| 404              | `NOT_FOUND` (user)    | `user_not_found`                         |
| 404              | `NOT_FOUND` (email lookup) | `users_not_found`                  |
| 404              | `NOT_FOUND` (message) | `message_not_found`                      |
| 400              | `INVALID_CURSOR`      | `invalid_cursor`                         |
| 400              | `MISSING_FILES`       | `no_file_data`                           |
| 429              | (rate limit)            | `ratelimited` (+ `Retry-After` header) |
| 500              | `INTERNAL_ERROR`      | `internal_error`                         |

### Response Envelope

```typescript
// Success — HTTP 200
{ ok: true, channel: "...", ts: "...", ... }

// Error — ALSO HTTP 200 (Slack convention)
{ ok: false, error: "channel_not_found" }
```

The adapter wraps every route handler in an error boundary that catches thrown errors and transforms them into the Slack envelope format.

---

## 8. Type Mapping — Bidirectional Transformer Specifications

### 8.1 ID Strategy: `ts` ↔ `messageId` / `conversationId`

**The biggest impedance mismatch**: Slack uses `ts` — a float timestamp like `"1503435956.000247"` — as the unique message identifier. Xyne uses UUIDs for `messageId` and `conversationId`.

**Decision: Use Xyne IDs as `ts` directly.**

Rationale: Most Slack SDKs treat `ts` as an opaque string identifier and never parse it as a float. Passing `ts: "550e8400-e29b-41d4-a716-446655440000"` works fine.

| Context                      | Slack Field              | Xyne Field           | Direction     | Resolution                                                        |
| ---------------------------- | ------------------------ | -------------------- | ------------- | ----------------------------------------------------------------- |
| Post message response        | `ts`                   | `messageId`        | Xyne → Slack | Direct map                                                        |
| Thread reply request         | `thread_ts`            | `conversationId`   | Slack → Xyne | Lookup:`messages.findById(thread_ts)` → `msg.conversationId` |
| Message in history           | `messages[].ts`        | `initialMessageId` | Xyne → Slack | Direct map                                                        |
| Thread parent in reply       | `messages[].thread_ts` | `conversationId`   | Xyne → Slack | Direct map                                                        |
| Update message request       | `ts`                   | `messageId`        | Slack → Xyne | Direct map                                                        |
| Conversation replies request | `ts`                   | `conversationId`   | Slack → Xyne | Lookup:`messages.findById(ts)` → `msg.conversationId`        |

**Implementation note**: For `thread_ts` and `conversations.replies` `ts`, the adapter treats these as `messageId` values and performs a DB lookup to resolve the actual `conversationId`. This is because Slack bots receive a `ts` (messageId) from `chat.postMessage` and pass it back as `thread_ts` — they never see the underlying `conversationId`.

---

### 8.2 `chat.postMessage`

**Slack docs**: https://docs.slack.dev/reference/methods/chat.postMessage

#### Request Transform: Slack → Xyne

| Slack Field                | Type                  | → | Xyne Field         | Type                       | Transform Logic                                                                                                                    |
| -------------------------- | --------------------- | -- | ------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `channel`                | `string`            | → | `channelId`      | `string`                 | Direct map. Slack requires channel ID.                                                                                             |
| `text`                   | `string`            | → | `text`           | `string`                 | Resolved via `resolveSlackMessageParts()` (mentions → Xyne spans), then parsed through `SlackBlockKitParser`.                    |
| `blocks`                 | `SlackBlock[]`      | → | `text`           | `string`                 | Resolved via `resolveSlackMessageParts()`, then parsed via `SlackBlockKitParser` or converted to FlowJSON.                        |
| `attachments`            | `SlackAttachment[]` | → | `attachments`    | `any[]`                  | Resolved via `resolveSlackMessageParts()`, then direct map.                                                                        |
| `thread_ts`              | `string \| null`    | → | `conversationId` | `string?`                | If string, resolve via message lookup (§8.1). If `null`/omitted, post to main channel. `null` is coerced to `undefined`.          |
| `mrkdwn`                 | `boolean`           | → | `contentFormat`  | `ContentFormat`          | Default `true`. If `mrkdwn=true`, set `contentFormat: 'markdown'`. If `mrkdwn=false`, text is resolved but not parsed as Block Kit. |
| `metadata`               | `object`            | → | `metadata`       | `Record<string,unknown>` | Direct map.                                                                                                                        |
| `reply_broadcast`        | `boolean`           | → | _(ignored)_      | —                         | Xyne has no equivalent of broadcasting thread replies to channel.                                                                  |
| `unfurl_links`           | `boolean`           | → | _(ignored)_      | —                         | Not in Xyne apps API.                                                                                                              |
| `unfurl_media`           | `boolean`           | → | _(ignored)_      | —                         | Not in Xyne apps API.                                                                                                              |
| `icon_emoji`             | `string`            | → | _(ignored)_      | —                         | Not in Xyne apps API.                                                                                                              |
| `icon_url`               | `string`            | → | _(ignored)_      | —                         | Not in Xyne apps API.                                                                                                              |
| `username`               | `string`            | → | _(echoed)_       | —                         | Not functional in Xyne, but echoed back in the response `message.username` field.                                                  |
| _(from auth middleware)_ | —                    | → | `userId`         | `string`                 | Injected by `authenticateApp`.                                                                                                   |

#### Length Limits

Slack recommends keeping `text` under 4,000 characters and truncates plain `text` over 40,000 characters. Xyne's `MessageRepository` has a stricter stored `content` limit of 10,000 characters after Slack text/block/attachment transformation. Because Xyne cannot persist content above that cap, `chat.postMessage` returns Slack-style `{ ok: false, error: "msg_too_long" }` when transformed content exceeds 10,000 characters.

#### Response Transform: Xyne → Slack

| Xyne Field                        | Type       | → | Slack Field           | Type        | Transform Logic                                                                      |
| --------------------------------- | ---------- | -- | --------------------- | ----------- | ------------------------------------------------------------------------------------ |
| _(success)_                     | —         | → | `ok`                | `boolean` | Always `true` on success.                                                          |
| _(resolve from conversationId)_ | —         | → | `channel`           | `string`  | Resolve `channelId` from `conversationId` using existing `resolveChannelId()`. |
| `messageId`                     | `string` | → | `ts`                | `string`  | Direct map (§8.1).                                                                  |
| _(echo input text)_             | —         | → | `message`           | `object`  | Construct:`{ text, type: "message", subtype: "bot_message", ts, bot_id: appId, username? }`.  |

**Xyne source type**: `ChatActionResponse` = `{ eventType: ChatEventType, conversationId: string, messageId: string }`

---

### 8.3 `chat.update`

**Slack docs**: https://docs.slack.dev/reference/methods/chat.update

#### Request Transform: Slack → Xyne

| Slack Field     | Type                  | → | Xyne Field      | Type       | Transform Logic                          |
| --------------- | --------------------- | -- | --------------- | ---------- | ---------------------------------------- |
| `channel`     | `string`            | → | `channelId`   | `string` | Direct map.                                                                            |
| `ts`          | `string`            | → | `messageId`   | `string` | Direct map (§8.1).                                                                    |
| `text`        | `string`            | → | `text`        | `string` | Resolve mentions via `resolveSlackMessageParts()`, then process through `SlackBlockKitParser`. |
| `blocks`      | `SlackBlock[]`      | → | `text`        | `string` | Resolve mentions, then parse via `SlackBlockKitParser`.                                |
| `attachments` | `SlackAttachment[]` | → | `attachments` | `any[]`  | Resolve mentions, then direct map.                                                     |

#### Length Limits

Same as `chat.postMessage`: Xyne rejects transformed content over 10,000 characters with `{ ok: false, error: "msg_too_long" }` before calling the message repository.

#### Response Transform: Xyne → Slack

| Xyne Field                        | Type       | → | Slack Field | Type        | Transform Logic             |
| --------------------------------- | ---------- | -- | ----------- | ----------- | --------------------------- |
| _(success)_                     | —         | → | `ok`      | `boolean` | `true`.                   |
| _(resolve from conversationId)_ | —         | → | `channel` | `string`  | Resolve channelId.          |
| `messageId`                     | `string` | → | `ts`      | `string`  | Direct map.                 |
| _(echo text)_                   | —         | → | `text`    | `string`  | Echo back submitted text.   |
| —                                | —         | → | `message` | `object`  | `{ text, user: userId }`. |

**Xyne source type**: `ChatActionResponse` = `{ eventType: ChatEventType.MESSAGE_UPDATED, conversationId, messageId }`

---

### 8.4 `conversations.list`

**Slack docs**: https://docs.slack.dev/reference/methods/conversations.list

#### Request Transform: Slack → Xyne

| Slack Field          | Type        | Default              | → | Xyne Field           | Transform Logic                                                                                                                                                          |
| -------------------- | ----------- | -------------------- | -- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types`            | `string`  | `"public_channel"` | → | `scopeType` filter | Comma-separated Slack types → Xyne scopeType. Map:`public_channel` → Xyne public, `private_channel` → Xyne private, `im` → Xyne DM, `mpim` → Xyne group DM. |
| `exclude_archived` | `boolean` | `false`            | → | _(ignored)_        | Xyne has no archive concept.                                                                                                                                             |
| `limit`            | `number`  | `100`              | → | `limit`            | Direct map. Slack max: 1000.                                                                                                                                             |
| `cursor`           | `string`  | —                   | → | `cursor`           | Direct map (both use opaque cursor strings).                                                                                                                             |
| `team_id`          | `string`  | —                   | → | _(ignored)_        | Single-workspace only.                                                                                                                                                   |

#### Response Transform: Xyne → Slack

| Xyne Field (`ChannelListResponse`) | Type        | → | Slack Field                       | Type        | Transform Logic                                                     |
| ------------------------------------ | ----------- | -- | --------------------------------- | ----------- | ------------------------------------------------------------------- |
| `items[].id`                       | `string`  | → | `channels[].id`                 | `string`  | Direct map.                                                         |
| `items[].name`                     | `string`  | → | `channels[].name`               | `string`  | Direct map.                                                         |
| `items[].description`              | `string?` | → | `channels[].purpose`            | `object`  | Wrap:`{ value: description ?? "", creator: "", last_set: 0 }`.    |
| —                                   | —          | → | `channels[].topic`              | `object`  | Default:`{ value: "", creator: "", last_set: 0 }`.                |
| `items[].scopeType`                | `string`  | → | `channels[].is_channel`         | `boolean` | `true` if scopeType indicates public channel.                     |
| `items[].scopeType`                | `string`  | → | `channels[].is_private`         | `boolean` | `true` if scopeType indicates private.                            |
| `items[].scopeType`                | `string`  | → | `channels[].is_im`              | `boolean` | `true` if scopeType indicates DM.                                 |
| `items[].scopeType`                | `string`  | → | `channels[].is_mpim`            | `boolean` | `true` if scopeType indicates group DM.                           |
| `items[].createdBy`                | `string`  | → | `channels[].creator`            | `string`  | Direct map.                                                         |
| `items[].createdAt`                | `Date`    | → | `channels[].created`            | `number`  | `Math.floor(date.getTime() / 1000)` — Unix timestamp in seconds. |
| `hasMore`                          | `boolean` | → | _(implicit)_                    | —          | Controls whether `next_cursor` is included.                       |
| `nextCursor`                       | `string?` | → | `response_metadata.next_cursor` | `string`  | Direct map if `hasMore=true`; empty string `""` otherwise.      |

**Xyne source type**: `ChannelListResponse` = `PaginatedResponse<ChannelListItem>`

---

### 8.5 `conversations.info`

**Slack docs**: https://docs.slack.dev/reference/methods/conversations.info

#### Request Transform: Slack → Xyne

| Slack Field             | Type        | → | Xyne Field            | Transform Logic                           |
| ----------------------- | ----------- | -- | --------------------- | ----------------------------------------- |
| `channel`             | `string`  | → | `channelId`         | Direct map.                               |
| `include_num_members` | `boolean` | → | _(always included)_ | Xyne always returns `participantCount`. |
| `include_locale`      | `boolean` | → | _(ignored)_         | Not in Xyne.                              |

Note: Slack documents `conversations.info` as GET, and the adapter also supports POST for packages that call all Web API methods with POST.

#### Response Transform: Xyne → Slack

| Xyne Field (`ChannelsResponse`) | Type        | → | Slack Field             | Type        | Transform Logic                                                  |
| --------------------------------- | ----------- | -- | ----------------------- | ----------- | ---------------------------------------------------------------- |
| `id`                            | `string`  | → | `channel.id`          | `string`  | Direct map.                                                      |
| `name`                          | `string`  | → | `channel.name`        | `string`  | Direct map.                                                      |
| `description`                   | `string?` | → | `channel.purpose`     | `object`  | Wrap:`{ value: description ?? "", creator: "", last_set: 0 }`. |
| —                                | —          | → | `channel.topic`       | `object`  | Default:`{ value: "", creator: "", last_set: 0 }`.             |
| `type`                          | `string`  | → | `channel.is_channel`  | `boolean` | Map type string.                                                 |
| `scopeType`                     | `string`  | → | `channel.is_private`  | `boolean` | Map scopeType.                                                   |
| `visibility`                    | `string`  | → | `channel.is_shared`   | `boolean` | Map visibility.                                                  |
| `createdBy`                     | `string`  | → | `channel.creator`     | `string`  | Direct map.                                                      |
| `createdAt`                     | `Date`    | → | `channel.created`     | `number`  | Date → Unix timestamp.                                          |
| `participantCount`              | `number`  | → | `channel.num_members` | `number`  | Direct map.                                                      |
| `projectId`                     | `string`  | → | _(dropped or custom)_ | —          | Not representable in Slack schema. Drop for now.                 |

**Xyne source type**: `ChannelsResponse` = `{ id, name, description?, type, scopeType, visibility, projectId, createdBy, createdAt, participantCount }`

---

### 8.6 `conversations.history`

**Slack docs**: https://docs.slack.dev/reference/methods/conversations.history

#### Request Transform: Slack → Xyne

| Slack Field              | Type        | Default   | → | Xyne Field    | Transform Logic                                                     |
| ------------------------ | ----------- | --------- | -- | ------------- | ------------------------------------------------------------------- |
| `channel`              | `string`  | —        | → | `channelId` | Direct map.                                                         |
| `limit`                | `number`  | `100`   | → | `limit`     | Direct map. Slack max: 1000. Xyne default: 1000.                    |
| `cursor`               | `string`  | —        | → | `cursor`    | Direct map.                                                         |
| `oldest`               | `string`  | `"0"`   | → | _(ignored)_ | Xyne pagination is cursor-only. Time-range filtering not supported. |
| `latest`               | `string`  | now       | → | _(ignored)_ | Same as above.                                                      |
| `inclusive`            | `boolean` | `false` | → | _(ignored)_ | Not applicable without time-range support.                          |
| `include_all_metadata` | `boolean` | `false` | → | _(ignored)_ | Xyne always includes available metadata.                            |

#### Response Transform: Xyne → Slack

| Xyne Field (`ChannelHistoryItem`) | Type                      | → | Slack Field                       | Type            | Transform Logic                                                               |
| ----------------------------------- | ------------------------- | -- | --------------------------------- | --------------- | ----------------------------------------------------------------------------- |
| `initialMessageId`                | `string`                | → | `messages[].ts`                 | `string`      | Direct map as opaque ID (§8.1).                                              |
| `conversationId`                  | `string`                | → | `messages[].thread_ts`          | `string`      | Direct map. Slack includes `thread_ts` on threaded messages.                |
| `cleanContent`                    | `string`                | → | `messages[].text`               | `string`      | Direct map. Use `cleanContent` (plain text) over `content` (HTML).        |
| `userId`                          | `string`                | → | `messages[].user`               | `string`      | Direct map.                                                                   |
| `createdAt`                       | `Date`                  | → | _(part of message object)_      | —              | Could optionally be included in a custom field. Not standard in Slack `ts`. |
| —                                  | —                        | → | `messages[].type`               | `string`      | Always `"message"`.                                                         |
| `attachments`                     | `AppEventAttachment[]?` | → | `messages[].files`              | `SlackFile[]` | Map `AppEventAttachment` → Slack file object (see §8.14).                 |
| `hasMore`                         | `boolean`               | → | `has_more`                      | `boolean`     | Direct map.                                                                   |
| `nextCursor`                      | `string?`               | → | `response_metadata.next_cursor` | `string`      | Direct map if `hasMore=true`; empty string otherwise.                       |

**Xyne source type**: `ChannelHistoryResponse` = `PaginatedResponse<ChannelHistoryItem>`

---

### 8.7 `conversations.replies`

**Slack docs**: https://docs.slack.dev/reference/methods/conversations.replies

#### Request Transform: Slack → Xyne

| Slack Field | Type       | → | Xyne Field         | Transform Logic                                                                                                |
| ----------- | ---------- | -- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `channel` | `string` | → | `channelId`      | Direct map.                                                                                                    |
| `ts`      | `string` | → | `conversationId` | Direct map (§8.1). In Slack,`ts` is the parent message timestamp. In Xyne, this maps to `conversationId`. |
| `limit`   | `number` | → | `limit`          | Direct map.                                                                                                    |
| `cursor`  | `string` | → | `cursor`         | Direct map.                                                                                                    |
| `oldest`  | `string` | → | _(ignored)_      | Xyne is cursor-only.                                                                                           |
| `latest`  | `string` | → | _(ignored)_      | Xyne is cursor-only.                                                                                           |

#### Response Transform: Xyne → Slack

| Xyne Field (`ConversationRepliesItem`) | Type                      | → | Slack Field                       | Type            | Transform Logic                      |
| ---------------------------------------- | ------------------------- | -- | --------------------------------- | --------------- | ------------------------------------ |
| `messageId`                            | `string`                | → | `messages[].ts`                 | `string`      | Direct map (§8.1).                  |
| `conversationId`                       | `string`                | → | `messages[].thread_ts`          | `string`      | Direct map.                          |
| `cleanContent`                         | `string`                | → | `messages[].text`               | `string`      | Direct map.                          |
| `userId`                               | `string`                | → | `messages[].user`               | `string`      | Direct map.                          |
| `createdAt`                            | `Date`                  | → | _(available)_                   | —              | Not standard in Slack `ts` format. |
| —                                       | —                        | → | `messages[].type`               | `string`      | Always `"message"`.                |
| `attachments`                          | `AppEventAttachment[]?` | → | `messages[].files`              | `SlackFile[]` | Map attachment format (§8.14).      |
| `hasMore`                              | `boolean`               | → | `has_more`                      | `boolean`     | Direct map.                          |
| `nextCursor`                           | `string?`               | → | `response_metadata.next_cursor` | `string`      | Direct map.                          |

**Xyne source type**: `ConversationRepliesResponse` = `PaginatedResponse<ConversationRepliesItem>`

---

### 8.8 `conversations.open`

**Slack docs**: https://docs.slack.dev/reference/methods/conversations.open

#### Request Transform: Slack → Xyne

| Slack Field     | Type        | → | Xyne Field       | Transform Logic                                                    |
| --------------- | ----------- | -- | ---------------- | ------------------------------------------------------------------ |
| `users`       | `string`  | → | `targetUserIds` | Comma-separated user IDs. One user creates/resumes a bot DM; multiple users create/resume a GROUP_DM with the bot. |
| `channel`     | `string`  | → | `channelId`    | Resume an existing IM/MPIM/channel by ID or name if the bot is already a participant. |
| `return_im`   | `boolean` | → | _(ignored)_    | Xyne always returns channel info.                                  |
| _(from auth)_ | —          | → | `userId`       | Bot's userId from JWT.                                             |
| _(from auth)_ | —          | → | `workspaceId`  | Resolved from `repositories.users.findById(userId).workspaceId`. |

**Implementation note**: `workspaceId` is resolved from the authenticated bot user's DB record (`botUser.workspaceId`). If the bot user has no workspace, the handler throws `"Workspace not found"` which maps to `internal_error`. Large GROUP_DM creation falls back to Xyne's existing private channel behavior when the participant-derived name would exceed DB limits.

#### Response Transform: Xyne → Slack

| Xyne Field    | Type       | → | Slack Field       | Type        | Transform Logic         |
| ------------- | ---------- | -- | ----------------- | ----------- | ----------------------- |
| `channelId` | `string` | → | `ok`            | `boolean` | `true`.               |
| `channelId` | `string` | → | `channel.id`    | `string`  | Direct map.             |
| `scopeType`  | `string` | → | `channel.is_im` | `boolean` | `true` for DM, `false` for MPIM/GROUP_DM. |

---

### 8.9 `users.info`

**Slack docs**: https://docs.slack.dev/reference/methods/users.info

#### Request Transform: Slack → Xyne

| Slack Field        | Type        | → | Xyne Field    | Transform Logic |
| ------------------ | ----------- | -- | ------------- | --------------- |
| `user`           | `string`  | → | `userId`    | Direct map.     |
| `include_locale` | `boolean` | → | _(ignored)_ | Not in Xyne.    |

#### Response Transform: Xyne → Slack

| Xyne Field (`UserResponse`) | Type        | → | Slack Field                                  | Type        | Transform Logic                                       |
| ----------------------------- | ----------- | -- | -------------------------------------------- | ----------- | ----------------------------------------------------- |
| `userId`                    | `string`  | → | `user.id`                                  | `string`  | Direct map.                                           |
| `name`                      | `string`  | → | `user.name`                                | `string`  | Use as username.                                      |
| `name`                      | `string`  | → | `user.real_name`                           | `string`  | Same value.                                           |
| `email`                     | `string`  | → | `user.profile.email`                       | `string`  | Direct map.                                           |
| `name`                      | `string`  | → | `user.profile.real_name`                   | `string`  | Direct map.                                           |
| `name`                      | `string`  | → | `user.profile.display_name`                | `string`  | Direct map.                                           |
| `picture`                   | `string?` | → | `user.profile.image_24` thru `image_512` | `string`  | Map single URL to all Slack image size fields.        |
| `userType`                  | `string`  | → | `user.is_bot`                              | `boolean` | `true` if userType indicates bot.                   |
| `userType`                  | `string`  | → | `user.is_admin`                            | `boolean` | `true` if userType indicates admin.                 |
| `status`                    | `string`  | → | `user.deleted`                             | `boolean` | `"ACTIVE"` → `false`, anything else → `true`. |
| `joined`                    | `Date`    | → | `user.updated`                             | `number`  | Date → Unix timestamp (seconds).                     |
| —                            | —          | → | `user.is_app_user`                         | `boolean` | `false` (default).                                  |
| —                            | —          | → | `user.team_id`                             | `string`  | Empty string or resolved from context.                |

**Xyne source type**: `UserResponse` = `{ userId, name, email, picture, userType, status, joined }`

---

### 8.10 `users.lookupByEmail`

**Slack docs**: https://docs.slack.dev/reference/methods/users.lookupByEmail

#### Request Transform: Slack → Xyne

| Slack Field | Type       | → | Xyne Field | Transform Logic |
| ----------- | ---------- | -- | ---------- | --------------- |
| `email`   | `string` | → | `email`  | Validate as email, then look up case-insensitively within the authenticated app user's workspace. |

#### Response Transform: Xyne → Slack

Uses the same Slack user object transformer as `users.info`.

| Xyne Field (`UserResponse`) | Type       | → | Slack Field | Transform Logic |
| ----------------------------- | ---------- | -- | ----------- | --------------- |
| `userId`, `name`, `email`, `picture`, `userType`, `status`, `joined` | — | → | `user` | Same mapping as §8.9. |

If no active user exists for the email in the authenticated workspace, return `{ ok: false, error: "users_not_found" }`.

**Xyne source type**: `UserResponse` = `{ userId, name, email, picture, userType, status, joined }`

---

### 8.11 `files.upload`

**Slack docs**: https://docs.slack.dev/reference/methods/files.upload (deprecated but widely used)

#### Request Transform: Slack → Xyne

| Slack Field         | Type       | → | Xyne Field           | Transform Logic                                                |
| ------------------- | ---------- | -- | -------------------- | -------------------------------------------------------------- |
| `channels`        | `string` | → | `channelId`        | Comma-separated channel IDs. Phase 1: take first channel only. |
| `file`            | `binary` | → | `files` (multer)   | Binary file data → multer-processed file array.               |
| `content`         | `string` | → | `text`             | Text/snippet content (alternative to binary file).             |
| `filename`        | `string` | → | _(multer handles)_ | Original filename.                                             |
| `filetype`        | `string` | → | _(multer handles)_ | File type hint.                                                |
| `initial_comment` | `string` | → | `text`             | Message text to accompany the upload.                          |
| `title`           | `string` | → | _(metadata)_       | File title.                                                    |
| `thread_ts`       | `string \| null` | → | `conversationId`   | If string, resolve via message lookup (§8.1). If `null`/omitted, upload to main channel. |
| _(from auth)_     | —         | → | `userId`           | From JWT.                                                      |

#### Response Transform: Xyne → Slack

| Xyne Field (`FileUploadResponse`) | Type       | → | Slack Field          | Type        | Transform Logic |
| ----------------------------------- | ---------- | -- | -------------------- | ----------- | --------------- |
| _(success)_                       | —         | → | `ok`               | `boolean` | `true`.       |
| `attachments[].fileid`            | `string` | → | `file.id`          | `string`  | Direct map.     |
| `attachments[].originalFilename`  | `string` | → | `file.name`        | `string`  | Direct map.     |
| `attachments[].url`               | `string` | → | `file.url_private` | `string`  | Direct map.     |
| `attachments[].url`               | `string` | → | `file.permalink`   | `string`  | Direct map.     |
| `attachments[].size`              | `number` | → | `file.size`        | `number`  | Direct map.     |
| `attachments[].mimeType`          | `string` | → | `file.mimetype`    | `string`  | Direct map.     |
| `messageId`                       | `string` | → | `file.shares.public/private[channelId][].ts` | `string` | Direct map; share object includes `reply_users`, `reply_users_count`, `reply_count`, and optional `channel_name`. |
| `channelId`                       | `string` | → | `file.channels[]` / `file.groups[]` / `file.ims[]` | `string[]` | Public channels go to `channels`, private channels to `groups`, DMs/group DMs to `ims`; non-matching arrays are empty. |

**Xyne source type**: `FileUploadResponse` = `{ eventType, conversationId, messageId, attachments: FileAttachment[] }`

---

### 8.12 `usergroups.list`

**Slack docs**: https://docs.slack.dev/reference/methods/usergroups.list

#### Request Transform: Slack → Xyne

Slack's optional filters are supported where Xyne has equivalent data.

| Slack Field          | → | Transform                                               |
| -------------------- | -- | ------------------------------------------------------- |
| `include_disabled` | → | `false` returns active groups only; `true` includes inactive groups. |
| `include_count`    | → | `true` includes `user_count`; `false` omits it. |
| `include_users`    | → | `true` includes `users[]` from Xyne user-group mappings. |
| `team_id`          | → | Accepted and ignored; Xyne auth is already workspace-scoped. |

#### Response Transform: Xyne → Slack

| Xyne Field (`UserGroupResponse`) | Type        | → | Slack Field                  | Type       | Transform Logic                                                             |
| ---------------------------------- | ----------- | -- | ---------------------------- | ---------- | --------------------------------------------------------------------------- |
| `id`                             | `string`  | → | `usergroups[].id`          | `string` | Direct map.                                                                 |
| `name`                           | `string`  | → | `usergroups[].name`        | `string` | Direct map.                                                                 |
| `alias`                          | `string?` | → | `usergroups[].handle`      | `string` | Map alias → Slack's `handle` field.                                      |
| `description`                    | `string?` | → | `usergroups[].description` | `string` | Direct map.                                                                 |
| `isActive`                       | `boolean` | → | `usergroups[].date_delete` | `number` | If `isActive=false`, set `date_delete` to a timestamp; otherwise `0`. |
| `memberCount`                    | `number`  | → | `usergroups[].user_count`  | `number` | Direct map.                                                                 |
| `createdAt`                      | `Date`    | → | `usergroups[].date_create` | `number` | Date → Unix timestamp (seconds).                                           |
| `updatedAt`                      | `Date`    | → | `usergroups[].date_update` | `number` | Date → Unix timestamp (seconds).                                           |
| `userGroupMappings[].userId`     | `string`  | → | `usergroups[].users[]`     | `string[]` | Included only when `include_users=true`.                                  |

**Xyne source type**: `UserGroupResponse` = `{ id, name, alias, description, isActive, memberCount, createdAt, updatedAt }`

---

### 8.13 `files.getUploadURLExternal` / `files.completeUploadExternal` (V2 Upload)

**Slack docs**: https://docs.slack.dev/reference/methods/files.getUploadURLExternal

The modern 3-step file upload flow used by `@slack/web-api` `filesUploadV2()`:

#### Step 1: `files.getUploadURLExternal`

Request: `{ filename: string, length: number, alt_text?: string, snippet_type?: string }`

Response: `{ ok: true, upload_url: string, file_id: string }`

Implementation:

- Generates a UUID `file_id`
- Creates a Redis entry (`slack_upload:<file_id>`, TTL 30 minutes) with `{ filename, userId, appId, status: 'pending' }`
- Returns an upload URL pointing to `/_upload/<file_id>` on the same host

#### Step 2: Binary upload to `/_upload/:fileId`

- Accepts raw binary body (`express.raw({ limit: '50mb' })`)
- Uses `slackRawBodyAuthenticateApp` for auth (preserves raw Buffer through auth flow)
- Validates `userId` matches the Redis state owner
- Uploads file via `uploadFiles()` service
- Updates Redis state to `{ status: 'uploaded', uploadResult: UploadedFileResult }`
- Returns `200 OK` (plain text, not JSON — matches Slack behavior)

#### Step 3: `files.completeUploadExternal`

Request: `{ files: [{ id: string, title?: string }], channel_id?: string, channels?: string, initial_comment?: string, thread_ts?: string | null }`

Implementation:

- Retrieves each file's `UploadedFileResult` from Redis
- Validates all files are `status: 'uploaded'` and owned by requesting user
- If `channel_id` or `channels` is provided, resolves the first channel, validates participant access, and calls `findOrCreateConversation()` with uploaded file results
- If neither channel field is provided, returns `{ ok: true, files }` without creating a Xyne conversation; Slack's private unshared-file library has no direct Xyne equivalent in this adapter
- Cleans up Redis keys
- Returns `{ ok: true, files: SlackFileObject[] }`

### 8.14 Attachment Format Mapping

Used by `conversations.history` and `conversations.replies` response transformers.

| Xyne Field (`AppEventAttachment`) | → | Slack Field (`SlackFile`) | Transform   |
| ----------------------------------- | -- | --------------------------- | ----------- |
| `attachmentId`                    | → | `id`                      | Direct map. |
| `fileName`                        | → | `name`                    | Direct map. |
| `fileName`                        | → | `title`                   | Direct map. |
| `fileSize`                        | → | `size`                    | Direct map. |
| `mimeType`                        | → | `mimetype`                | Direct map. |
| `fileUrl`                         | → | `url_private`             | Direct map. |
| `fileUrl`                         | → | `permalink`               | Direct map. |

---

## 9. Gaps & Limitations

### 9.1 Things That Won't Work Perfectly

| Gap                                | Impact                                                               | Mitigation                                                          |
| ---------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `ts` is UUID not float           | Bots that parse `ts` as a number will break.                       | Most SDKs treat `ts` as opaque string — those work fine.         |
| `oldest`/`latest` time filters | `conversations.history` and `.replies` ignore time-range params. | Cursor-based pagination works. Time filtering could be added later. |
| `reply_broadcast`                | Thread-to-channel broadcast not supported.                           | Silently ignored.                                                   |
| Multi-channel `files.upload`     | Slack allows comma-separated channels. Xyne supports one.            | Uses first channel only.                                            |
| Private unshared file library    | Slack can complete an upload with no channel. Xyne Apps API has no standalone private file library record. | `files.completeUploadExternal` returns file objects but does not create a conversation when no channel is supplied. |
| Read/list/info HTTP method compatibility | Slack documents read/list/info methods as GET, while some Slack packages call every Web API method with POST. | Expose both GET and equivalent POST routes. GET parses `req.query`; POST parses `req.body`. |

### 9.2 Xyne-Only Features Not Exposed via Slack API

- Flow UI (`flow` field in `postMessage`) — bots should use Block Kit instead
- `markdownText` with YAML frontmatter
- `channelName` routing (Slack requires channel ID)
- Tickets API
- Email API
- Agent Progress signals

### 9.3 Slack-Only Features Not Available in Xyne

- Message deletion (`chat.delete`)
- Reactions (`reactions.add/remove`)
- User listing (`users.list`)
- File listing (`files.list`)
- Ephemeral messages (`chat.postEphemeral`)
- Channel creation/management (`conversations.create/archive/invite/kick`)
- Interactive components callbacks (buttons, modals)
- Link unfurling
- Events API / Socket Mode (Xyne has webhook delivery — different contract)

---

## 10. Implementation Details

### 10.1 Code Structure

The adapter follows the repo's controller pattern:

- **`routes.ts`** — Thin wiring only. Instantiates `SlackController`, maps routes to controller methods with middleware.
- **`controller.ts`** — `SlackController` class with arrow function properties (one per endpoint). Zod schemas at module scope. Each handler wrapped with `wrapSlackHandler`.
- **`middleware.ts`** — `slackAuthenticateApp`, `slackRawBodyAuthenticateApp`, `slackChannelValidation`. Also exports `getSlackAuthContext()` and `resolveSlackChannel()` helpers.

```typescript
// routes.ts — thin wiring
const controller = new SlackController();
router.use(slackAuthenticateApp);
router.post('/chat.postMessage', slackChannelValidation('body'), controller.chatPostMessage);

// Read/list/info endpoints expose both GET and POST
router.get('/conversations.history', slackChannelValidation('query'), controller.conversationsHistory);
router.post('/conversations.history', slackChannelValidation('body'), controller.conversationsHistory);
```

### 10.2 Handler Pattern

Each handler in `SlackController` follows this pattern:

```typescript
function getSlackParams(req: Request): unknown {
  return req.method === 'GET' ? req.query : req.body;
}

chatPostMessage = wrapSlackHandler(async (req: Request, res: Response) => {
  // 1. Validate with Zod (reads from query for GET, body for POST)
  const parsed = PostMessageSchema.safeParse(getSlackParams(req));
  if (!parsed.success) { res.status(200).json({ ok: false, error: 'invalid_arguments' }); return; }

  // 2. Transform Slack request → Xyne args
  const args = transformPostMessage(parsed.data, getSlackAuthContext(req));

  // 3. Call Xyne core logic directly
  const result = await findOrCreateConversation(args.channelId, args.userId, args.content, ...);

  // 4. Transform Xyne response → Slack response
  res.status(200).json(transformPostMessageResponse(result, channelId, text, appId));
});
```

### 10.3 Error Boundary

`wrapSlackHandler` (in `error-transformer.ts`) wraps every handler to ensure unhandled errors return HTTP 200 with Slack error format:

```typescript
export function wrapSlackHandler(handler: AsyncHandler): AsyncHandler {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      logger.error('[SlackAdapter] Unhandled error:', error);
      const slackError = transformSlackError(error);
      res.status(200).json(slackError);
    }
  };
}
```

### 10.4 Request Parameter Extraction

`getSlackParams(req)` is a small helper used by all read/list/info handlers:

- For **GET** requests, reads parameters from `req.query`
- For **POST** requests, reads parameters from `req.body`

This enables both `GET /conversations.history?channel=C123&limit=10` and `POST /conversations.history` with the same parameters in the body.

### 10.5 Channel Validation Middleware

`slackChannelValidation('body')` (or `'query'` for GET routes) runs before handlers that need a channel:

1. Reads `channel` from request body for POST methods or query params for GET methods
2. Resolves via `resolveSlackChannel()` — tries `findById`, then `findByName`
3. Checks `channelParticipants.isParticipant()` — returns `not_in_channel` if unauthorized
4. Sets `req._resolvedChannelId` for the handler

### 10.6 Input Validation

Zod schemas handle Slack's `application/x-www-form-urlencoded` quirks:

- `SlackBooleanSchema` — coerces `"true"`/`"false"` strings to booleans
- `SlackArraySchema` — parses JSON-encoded array strings (e.g., `blocks` sent as string)
- `SlackRecordSchema` — parses JSON-encoded object strings
- `SlackOptionalStringSchema` — coerces `null` to `undefined`; used for nullable Slack fields such as `thread_ts`

### 10.7 Core Functions Used

| Function                                             | File                                                                         | Used By                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| `findOrCreateConversation()`                       | `apps/core/conversationUtils.ts`                                           | `chat.postMessage`, `files.completeUploadExternal` |
| `updateConversation()`                             | `apps/core/conversationUtils.ts`                                           | `chat.update`                                        |
| `getChannelHistory()`                              | `apps/core/conversationUtils.ts`                                           | `conversations.history`                              |
| `getConversationReplies()`                         | `apps/core/conversationUtils.ts`                                           | `conversations.replies`                              |
| `getUserData()`                                    | `apps/core/userUtils.ts`                                                   | `users.info`                                         |
| `getAllUserGroups()`                               | `apps/core/userGroupUtils.ts`                                              | `usergroups.list`                                    |
| `ingestAttachment()`                               | `apps/core/fileUtils.ts`                                                   | `files.upload` — accepts optional `workspaceId` param for mention resolution |
| `uploadFiles()`                                    | `services/fileUploadService.ts`                                            | `_upload/:fileId` (V2 binary upload)                 |
| `resolveSlackMessageParts()`                       | `integrations/adapters/slack-webhook-tickets/utils/slackUtils.ts`         | `chat.postMessage`, `chat.update` — resolves user/group/channel mentions before BlockKit parsing |
| `resolveSlackText()`                               | `integrations/adapters/slack-webhook-tickets/utils/slackUtils.ts`         | `chat.postMessage`, `chat.update` — resolves mentions in plain text |
| `unifiedDMService.getOrCreateBotDM()`              | `bots/unified/services/unified-dm-service.ts`                              | `conversations.open`                                 |
| `repositories.channels.findById()`                 | `database/repositories`                                                    | `conversations.info`, channel resolution             |
| `repositories.channels.findByName()`               | `database/repositories`                                                    | Channel resolution fallback                            |
| `repositories.channels.findManyPaginated()`        | `database/repositories`                                                    | `conversations.list`                                 |
| `repositories.messages.findById()`                 | `database/repositories`                                                    | `thread_ts` / `ts` → conversationId resolution    |
| `repositories.users.findByEmailCaseInsensitive()`  | `database/repositories`                                                    | `users.lookupByEmail`                                |
| `repositories.channelParticipants.isParticipant()` | `database/repositories`                                                    | Channel access validation                              |
| `redisService.set/get/del()`                       | `services/redisService.ts`                                                 | File Upload V2 state management                        |
| `SlackBlockKitParser.parse()`                      | `integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser.ts` | `chat.postMessage`, `chat.update` — called after `resolveSlackMessageParts()` |
| `authenticateApp()`                                | `apps/middelware/authenticator.ts`                                         | All endpoints (wrapped by `slackAuthenticateApp`)    |

---

## 11. Sequencing

| Step | Scope          | Description                                                                                         |
| ---- | -------------- | --------------------------------------------------------------------------------------------------- |
| 1    | Foundation     | Generic interfaces, directory structure, registry, error transformer, Slack types                   |
| 2    | Chat           | `chat.postMessage`, `chat.update` — request/response transformers + route handlers             |
| 3    | Conversations  | `conversations.history`, `.replies`, `.info`, `.list`, `.open` — transformers + handlers |
| 4    | Users + Groups | `users.info`, `users.lookupByEmail`, `usergroups.list` — transformers + handlers               |
| 5    | Files          | `files.upload` — transformer + handler                                                           |
| 6    | Mount + Wire   | Mount `/api/apps/slack` in apps router, register adapter                                          |
| 7    | Test           | Integration tests for all implemented endpoints, test with `@slack/web-api` SDK                   |

---

## 12. Verification Plan

1. **Manual adapter check**: Point `@slack/web-api` WebClient at Xyne base URL and verify implemented methods end-to-end when credentials/server are available.
2. **Shape check**: Confirm both query-param GET and body-param POST variants for read methods such as `users.lookupByEmail`, `users.info`, and `conversations.history`.
3. **Error cases**: Invalid auth → `{ok: false, error: "not_authed"}`. Missing channel → `{ok: false, error: "channel_not_found"}`. All Web API adapter errors return HTTP 200.
4. **Regression**: Verify existing `/api/apps/*` endpoints are completely unaffected.

---

## 13. Resolved Questions

1. **`workspaceId` for `conversations.open`**: **Resolved** — resolved from `repositories.users.findById(userId).workspaceId` (the authenticated bot user's workspace).
2. **Slack `types` filter mapping**: **Resolved** — `im` → `{scopeType: 'DM'}`, `mpim` → `{scopeType: 'GROUP_DM'}`, `public_channel` → `{scopeType: 'DEFAULT', visibility: 'PUBLIC'}`, `private_channel` → `{scopeType: 'DEFAULT', visibility: 'PRIVATE'}`. Single-type filter only; multi-type or unrecognized → no filter (returns all).
3. **Block Kit in responses**: **Resolved** — `text` only. No Block Kit `blocks` in responses. `cleanContent` mapped to `text`.
4. **`auth.test`**: **Resolved** — returns Slack-style token identity from the Xyne JWT auth context.

## 14. Open Questions

1. **Rate limiting**: Should the Slack adapter have its own rate limiting to match Slack's tier system? Or rely on Xyne's existing rate limiting?
2. **File Upload V2 partial failure cleanup**: If `files.completeUploadExternal` fails mid-way through a multi-file upload, earlier files' Redis state is not cleaned up (relies on TTL expiry). Should we add explicit cleanup on failure?
