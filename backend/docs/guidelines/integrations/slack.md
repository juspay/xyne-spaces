# Slack Integration

Sync Slack channel messages into Xyne conversations and tickets.

**Location:** `src/integrations/adapters/slack-webhook-tickets/`

---

## How It Works

1. Slack sends Events API webhooks to `/api/external-source-sync/slack-{channelId}/ingest`
2. Flow extracts channel ID and routes to correct source
3. Authenticator validates HMAC signature using signing secret
4. Transformer converts Slack Block Kit to plain text
5. Postprocessor creates tickets for top-level messages

---

## Adapter Files

| File | Purpose |
|------|---------|
| `index.ts` | Adapter registration |
| `authenticator.ts` | HMAC signature validation |
| `transformer.ts` | Block Kit parsing, markdown conversion |
| `flow.ts` | Dynamic source routing by channel ID, mention resolution |
| `postprocessor.ts` | Ticket creation, workflow triggers |
| `types.ts` | Slack payload types |
| `utils/slackBlockKitParser.ts` | Parse Block Kit to text |
| `utils/slackUserResolver.ts` | Resolve user mentions |

---

## Authentication

- Uses `x-slack-signature` header with HMAC-SHA256
- Validates `x-slack-request-timestamp` (prevents replay attacks within 5 minutes)
- Credentials stored encrypted: `signingSecret`, `botOauthToken`

**Validation Steps:**
1. Extract timestamp from `x-slack-request-timestamp`
2. Check timestamp is within 5 minutes of current time
3. Compute HMAC: `v0:{timestamp}:{rawBody}`
4. Compare computed signature with `x-slack-signature`

---

## Source Naming

- Pattern: `slack-{channelId}` (e.g., `slack-C09RF2JQTE1`)
- Flow dynamically determines source from channel ID in payload
- Each Slack channel maps to one ExternalSource record

---

## URL Verification

Slack sends `url_verification` challenge during app setup:

**Request:**
```json
{
  "type": "url_verification",
  "challenge": "abc123..."
}
```

**Response:**
```json
{
  "challenge": "abc123..."
}
```

Handled in `flow.ts` via `isTestPayload()` method.

---

## Message Processing

**Top-level messages** (no `thread_ts` or `thread_ts === ts`):
- Create new conversation
- Create ticket via postprocessor
- Trigger workflow if configured

**Thread replies** (`thread_ts` !== `ts`):
- Find existing conversation by `externalThreadId`
- Add message to conversation

---

## Block Kit Parsing

Slack messages use Block Kit format. Transformer handles:
- `*bold*` -> bold text
- `_italic_` -> italic text
- `~strikethrough~` -> strikethrough
- `` `code` `` -> inline code
- ` ```blocks``` ` -> code blocks
- Links, lists, mentions

---

## User Mention Resolution

Flow resolves `<@U123ABC>` mentions to actual usernames using Slack API:
- Uses `botOauthToken` for API calls
- Caches user lookups to reduce API calls
- Replaces mention IDs with `@username`

---

## Credentials

Store in `ExternalSource.credentials` (encrypted):

```json
{
  "signingSecret": "your-signing-secret",
  "botOauthToken": "xoxb-your-bot-token"
}
```

---

## Event Types Handled

| Event | Action |
|-------|--------|
| `message` | New message in channel |
| `message_changed` | Message edited |
| `app_mention` | Bot mentioned |
