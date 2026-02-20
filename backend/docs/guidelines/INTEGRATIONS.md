# External Integrations Guide

External integrations for syncing data from third-party platforms. Located in `src/integrations/`, `src/services/`, and `src/bitbucket/`.

---

## Integration Overview

| Platform | Type | Purpose | Location |
|----------|------|---------|----------|
| **Slack** | Webhook Adapter | Sync messages to tickets/conversations | `src/integrations/adapters/slack-webhook-tickets/` |
| **Zoho** | Webhook Adapter | Sync Zoho Desk tickets/threads | `src/integrations/adapters/zoho/` |
| **Bitbucket** | Direct API | PR operations, webhooks, repository data | `src/services/bitbucketService.ts`, `src/bitbucket/` |
| **Jenkins** | Direct API | CI/CD build triggers, status monitoring | `src/services/jenkinsService.ts` |
| **JAF** | AI Framework | Agent execution via `@xynehq/jaf` | `src/agents/`, `framework/` |

---

## Integration System Architecture

The adapter-based integration system uses a modular pipeline:

```
External Platform → Webhook POST → Adapter Resolution → Authentication → Flow → Transform → Sync to DB
```

**Endpoint:** `POST /api/external-source-sync/:sourceName/ingest`

**Components:**
1. **Adapter Registry** - Maps source names to platform adapters
2. **Authenticator** - Validates webhook authenticity
3. **Flow** (optional) - Preprocessing, source routing
4. **Transformer** - Normalizes platform-specific data
5. **Postprocessor** (optional) - Creates tickets, triggers workflows

---

## Slack Integration

### Purpose
Sync Slack channel messages into Xyne conversations and tickets.

### How It Works
1. Slack sends Events API webhooks to `/api/external-source-sync/slack-{channelId}/ingest`
2. Flow extracts channel ID and routes to correct source
3. Authenticator validates HMAC signature using signing secret
4. Transformer converts Slack Block Kit to plain text
5. Postprocessor creates tickets for top-level messages

### Adapter Files

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

### Authentication
- Uses `x-slack-signature` header with HMAC-SHA256
- Validates `x-slack-request-timestamp` (prevents replay attacks)
- Credentials: `signingSecret`, `botOauthToken` (stored encrypted in DB)

### Source Naming
- Pattern: `slack-{channelId}` (e.g., `slack-C09RF2JQTE1`)
- Flow dynamically determines source from channel ID in payload

### URL Verification
- Handles `url_verification` challenge for Slack app setup
- Returns challenge token in response body

---

## Zoho Integration

### Purpose
Sync Zoho Desk tickets and email threads into Xyne conversations.

### How It Works
1. Zoho sends webhook to `/api/external-source-sync/zoho-{sourceName}/ingest`
2. Authenticator validates RS256 JWT using JWK (JSON Web Keys)
3. Transformer extracts ticket/thread data, converts HTML to text
4. Messages grouped by `externalThreadId` (ticket ID)

### Adapter Files

| File | Purpose |
|------|---------|
| `index.ts` | Adapter registration |
| `authenticator.ts` | RS256 JWT validation with JWK |
| `transformer.ts` | HTML to text, email data extraction |

### Authentication
- Uses `x-zdesk-jwt` header with RS256 algorithm
- JWK Set stored encrypted in `credentials` field
- Validates `iss` (org ID) and `aud` (webhook ID) claims
- JWT expires after 10 minutes

### Security Considerations
- JWT signs only the header payload, NOT the request body
- Mitigations: JWT expiration, duplicate detection via `externalId`
- Consider: Track JWT IDs in Redis, whitelist Zoho IPs

### Event Types
- `Ticket_Create` - New ticket created
- `Ticket_Thread_Add` - New email/reply on ticket
- `Ticket_Update` - Ticket status/field changes

---

## Bitbucket Integration

### Purpose
Git integration for PR operations, webhooks, and repository interactions.

### Services

| Service | Purpose |
|---------|---------|
| `bitbucketService.ts` | API operations, PR fetching, comments |
| `bitbucketWebhookService.ts` | Process Bitbucket webhooks |
| `multiBitbucketService.ts` | Multi-repository operations |

### Configuration

```
BITBUCKET_BASE_URL - Bitbucket server URL
BITBUCKET_USERNAME - API username
BITBUCKET_PASSWORD or BITBUCKET_TOKEN - Authentication
```

### API Operations
- `getPullRequests(state, limit, start)` - Fetch PRs by state
- `getPullRequestComments(prId)` - Get PR comments
- `getPullRequestsFromLastDays(days)` - Recent PRs with comment counts
- `getCommits(prId)` - Get commits for a PR
- `getChanges(prId)` - Get file changes

### Webhook Validation
- Middleware: `bitbucketWebhookMiddleware.verify`
- Validates webhook signatures for authenticity

### Location
- API wrapper: `src/bitbucket/apis.ts`
- Service: `src/services/bitbucketService.ts`
- Routes: Applied in `app.ts` with auth middleware

---

## Jenkins Integration

### Purpose
CI/CD integration for triggering builds and monitoring pipeline status.

### Service
`src/services/jenkinsService.ts` - Singleton service

### Configuration

```
JENKINS_BASE_URL - Jenkins server URL
JENKINS_USERNAME - API username
JENKINS_API_TOKEN - API token
JENKINS_JOB_PATH - Path to job (e.g., /job/xyne-spaces)
```

### API Operations
- `isAvailable()` - Check if Jenkins is configured
- `triggerBuild(branch, parameters)` - Trigger a build
- `getLatestBuild(branch)` - Get latest build info
- `getBuildStages(buildNumber, branch)` - Get pipeline stages

### Authentication
- Uses Basic auth with username:apiToken
- Handles CSRF crumb for POST requests

### Routes
- `GET /api/jenkins/builds/:branch/latest` - Get latest build
- `GET /api/jenkins/builds/:branch/:buildNumber/stages` - Get stages
- `POST /api/jenkins/builds/:branch/trigger` - Trigger build

---

## JAF (Juspay Agent Framework)

### Purpose
AI agent execution framework for intelligent automation.

### Package
`@xynehq/jaf` - External NPM package

### Usage in Agents

| Agent | Purpose | Location |
|-------|---------|----------|
| `xyne-ai` | Main AI assistant | `src/agents/xyne-ai/` |
| `summariser` | Content summarization | `src/agents/summariser/` |
| `ticket-duplicate` | Duplicate detection | `src/agents/ticket-duplicate/` |
| `title-generator` | Auto-generate titles | `src/services/agents/title-generator.ts` |

### Key Imports
- `Agent`, `Tool`, `Message` - Core types
- `Streaming` - Stream response handling
- `getOtelTraceId` - OpenTelemetry tracing

### Configuration

```
LITELLM_API_BASE - LiteLLM server URL
LITELLM_MODEL - Model name
LITELLM_API_KEY - API key
```

### Creating Tools
Tools extend agent capabilities with specific functions:
- `genius.ts` - Code generation
- `search_relevant_tickets.ts` - Ticket search
- `fetch_thread_messages.ts` - Message fetching
- `research_agent.ts` - Research operations

---

## Adding New Integration

### Adapter-Based (Slack, Zoho style)

1. Create directory: `src/integrations/adapters/{platform}/`

2. Required files:
   - `index.ts` - Register adapter
   - `authenticator.ts` - Validate webhooks
   - `transformer.ts` - Normalize data

3. Optional files:
   - `flow.ts` - Preprocessing, source routing
   - `postprocessor.ts` - Post-sync actions
   - `types.ts` - Platform-specific types

4. Register in `src/integrations/core/externalSourceRegistry.ts`

### Direct API (Bitbucket, Jenkins style)

1. Create service: `src/services/{platform}Service.ts`

2. Add configuration to `src/config/env.ts`

3. Create routes: `src/routes/{platform}.ts`

4. Register routes in `app.ts`

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `ExternalSource` | Source configuration, encrypted credentials, channel mapping |
| `ExternalMessage` | Deduplication tracking, message-to-source mapping |

---

## Credentials Management

- All credentials stored encrypted in `ExternalSource.credentials`
- Use `encryptionService.encrypt()` before storing
- Use `decrypt()` in authenticator before validation
- Never log decrypted credentials

---

## Key Files

| File | Purpose |
|------|---------|
| `src/integrations/core/adapterRegistry.ts` | Adapter registration and lookup |
| `src/integrations/core/adapterFactory.ts` | Create adapter instances |
| `src/integrations/core/core.ts` | Main orchestration (preprocess → transform → sync) |
| `src/integrations/core/types.ts` | `NormalizedData`, `ExternalSourcePlatform` |
| `src/integrations/middleware/adapterResolver.ts` | Resolve adapter from source name |
| `src/integrations/routes/external-source-sync.ts` | Webhook endpoint |
| `src/services/encryptionService.ts` | Credential encryption/decryption |

---

## Best Practices

1. **Always validate webhook signatures** - Prevent spoofed requests

2. **Store credentials encrypted** - Never store plaintext API keys

3. **Implement deduplication** - Use `externalId` to prevent duplicate processing

4. **Log without sensitive data** - Never log tokens, passwords, or credentials

5. **Handle test webhooks** - Most platforms send test payloads during setup

6. **Use normalized data format** - All adapters output `NormalizedData`

7. **Group by thread ID** - Use `externalThreadId` for conversation grouping

---

## Anti-Patterns

- Storing credentials in plaintext
- Skipping webhook signature validation
- Processing duplicate messages (always check `externalId`)
- Hardcoding platform-specific logic in core
- Not handling webhook retries (platforms retry on failure)
- Exposing internal errors to webhook responses
