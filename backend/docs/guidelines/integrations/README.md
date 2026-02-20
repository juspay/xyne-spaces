# External Integrations

External integrations for syncing data from third-party platforms.

---

## Available Integrations

| Platform | Type | Purpose | Documentation |
|----------|------|---------|---------------|
| **Slack** | Webhook Adapter | Sync messages to tickets/conversations | [slack.md](slack.md) |
| **Zoho** | Webhook Adapter | Sync Zoho Desk tickets/threads | [zoho.md](zoho.md) |
| **Bitbucket** | Direct API | PR operations, webhooks, repository data | [bitbucket.md](bitbucket.md) |
| **Jenkins** | Direct API | CI/CD build triggers, status monitoring | [jenkins.md](jenkins.md) |
| **JAF** | AI Framework | Agent execution via `@xynehq/jaf` | [jaf.md](jaf.md) |

---

## Integration System Architecture

The adapter-based integration system uses a modular pipeline:

```
External Platform -> Webhook POST -> Adapter Resolution -> Authentication -> Flow -> Transform -> Sync to DB
```

**Endpoint:** `POST /api/external-source-sync/:sourceName/ingest`

**Components:**
1. **Adapter Registry** - Maps source names to platform adapters
2. **Authenticator** - Validates webhook authenticity
3. **Flow** (optional) - Preprocessing, source routing
4. **Transformer** - Normalizes platform-specific data
5. **Postprocessor** (optional) - Creates tickets, triggers workflows

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
| `src/integrations/core/core.ts` | Main orchestration (preprocess -> transform -> sync) |
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
