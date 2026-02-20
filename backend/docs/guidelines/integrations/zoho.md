# Zoho Integration

Sync Zoho Desk tickets and email threads into Xyne conversations.

**Location:** `src/integrations/adapters/zoho/`

---

## How It Works

1. Zoho sends webhook to `/api/external-source-sync/zoho-{sourceName}/ingest`
2. Authenticator validates RS256 JWT using JWK (JSON Web Keys)
3. Transformer extracts ticket/thread data, converts HTML to text
4. Messages grouped by `externalThreadId` (ticket ID)

---

## Adapter Files

| File | Purpose |
|------|---------|
| `index.ts` | Adapter registration |
| `authenticator.ts` | RS256 JWT validation with JWK |
| `transformer.ts` | HTML to text, email data extraction |

---

## Authentication

- Uses `x-zdesk-jwt` header with RS256 algorithm
- JWK Set stored encrypted in `credentials` field
- Validates `iss` (org ID) and `aud` (webhook ID) claims
- JWT expires after 10 minutes

**Validation Steps:**
1. Extract JWT from `x-zdesk-jwt` header
2. Decode JWT header to get `kid` (key ID)
3. Find matching key in JWK Set
4. Verify signature using RSA public key
5. Validate claims (`iss`, `aud`, `exp`)

---

## Security Considerations

**Important:** JWT signs only the header payload, NOT the request body.

This means:
- JWT proves request came from Zoho
- Does NOT guarantee body wasn't tampered in transit
- Replay attack possible within 10-minute expiration window

**Mitigations in place:**
- JWT expiration (10 minutes)
- Duplicate detection via `externalId` in database

**Additional protections to consider:**
- Track processed JWT IDs (jti claim) in Redis
- Whitelist Zoho IP addresses at network level

---

## Event Types

| Event | Description |
|-------|-------------|
| `Ticket_Create` | New ticket created |
| `Ticket_Thread_Add` | New email/reply on ticket |
| `Ticket_Update` | Ticket status/field changes |

---

## Data Transformation

**Input:** Zoho webhook payload with HTML content

**Output:** `NormalizedData` with:
- `externalId` - Thread/email ID
- `externalThreadId` - Ticket ID (for grouping)
- `content` - Plain text (HTML converted)
- `author` - Sender name and email
- `emailData` - Subject, to, from, cc, bcc
- `metadata` - Event type, timestamp, ticket number, web URL

---

## HTML to Text Conversion

Transformer converts Zoho HTML emails:
- Strips HTML tags
- Preserves line breaks
- Combines subject and body
- Handles email signatures

---

## Credentials

Store in `ExternalSource.credentials` (encrypted):

```json
{
  "jwkSet": "{\"keys\": [...]}",
  "apiKey": "optional-api-key"
}
```

**Getting JWK Set:**
1. Go to Zoho Desk Admin
2. Navigate to Webhooks settings
3. Copy JWK Set from webhook configuration

---

## Test Webhooks

Zoho sends test webhooks during setup. Authenticator detects and skips:
- Returns `{ authenticated: true, skipProcessing: true }`
- Logged as "Test webhook detected"

---

## Thread Grouping

- Each ticket creates one conversation
- All emails/threads on same ticket grouped by `externalThreadId`
- First message becomes conversation start
- Replies added to existing conversation
