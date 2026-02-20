# Bitbucket Integration

Git integration for PR operations, webhooks, and repository interactions.

**Location:** `src/services/bitbucketService.ts`, `src/bitbucket/`

---

## Services

| Service | Purpose |
|---------|---------|
| `bitbucketService.ts` | API operations, PR fetching, comments |
| `bitbucketWebhookService.ts` | Process Bitbucket webhooks |
| `multiBitbucketService.ts` | Multi-repository operations |

---

## Configuration

| Variable | Purpose |
|----------|---------|
| `BITBUCKET_BASE_URL` | Bitbucket server URL |
| `BITBUCKET_USERNAME` | API username |
| `BITBUCKET_PASSWORD` | Password authentication |
| `BITBUCKET_TOKEN` | Bearer token authentication (preferred) |

---

## Authentication

Two modes supported:

**Bearer Token (preferred):**
```
Authorization: Bearer {token}
```

**Basic Auth:**
```
Authorization: Basic {base64(username:password)}
```

---

## API Operations

### Pull Requests

| Method | Purpose |
|--------|---------|
| `getPullRequests(state, limit, start)` | Fetch PRs by state (OPEN, MERGED, DECLINED, ALL) |
| `getPullRequestComments(prId)` | Get comments on a PR |
| `getPullRequestsFromLastDays(days)` | Recent PRs with comment counts |

### Commits and Changes

| Method | Purpose |
|--------|---------|
| `getCommits(prId)` | Get commits for a PR |
| `getChanges(prId)` | Get file changes in a PR |

---

## Pagination

Bitbucket uses cursor-based pagination:

```typescript
// Internal helper handles pagination automatically
private async fetchAllPages<T>(endpoint: string): Promise<T[]>
```

Response format:
```json
{
  "values": [...],
  "isLastPage": false,
  "nextPageStart": 50
}
```

---

## Webhook Validation

- Middleware: `bitbucketWebhookMiddleware.verify`
- Validates webhook signatures for authenticity
- Applied in `app.ts` for Bitbucket webhook routes

---

## PR Status Mapping

| Bitbucket State | Mapped Status |
|-----------------|---------------|
| `OPEN` (no comments) | `Pending` |
| `OPEN` (with comments) | `Commented` |
| `MERGED` | `Merged` |
| `DECLINED` | `Rejected` |

---

## File Locations

| File | Purpose |
|------|---------|
| `src/bitbucket/apis.ts` | API wrapper functions |
| `src/services/bitbucketService.ts` | Main service class |
| `src/services/bitbucketWebhookService.ts` | Webhook processing |
| `src/services/multiBitbucketService.ts` | Multi-repo operations |
| `src/middleware/bitbucketWebhookValidator.ts` | Webhook signature validation |
| `src/types/bitbucket.ts` | Type definitions |

---

## Usage Example

```typescript
import { BitbucketService } from '@/services/bitbucketService';

const bitbucket = new BitbucketService({
  baseUrl: config.bitbucket.baseUrl,
  projectKey: 'XYNE',
  repositorySlug: 'xyne-spaces',
  token: config.bitbucket.token,
});

// Get open PRs
const openPRs = await bitbucket.getPullRequests('OPEN');

// Get PRs from last 3 days
const recentPRs = await bitbucket.getPullRequestsFromLastDays(3);
```

---

## Error Handling

All API errors logged with context:
- Endpoint URL
- HTTP status code
- Error message

Service throws errors for:
- Missing authentication credentials
- API request failures
- Invalid responses
