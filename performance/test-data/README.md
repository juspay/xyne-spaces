# Performance test identities

Create an untracked JSON file from `users.example.json`. Each entry must describe one dedicated
non-production test identity and a conversation that the identity is allowed to read and write.

```json
{
  "users": [
    {
      "userId": "stable-test-user-id",
      "token": "short-lived-bearer-token",
      "workspaceId": "dedicated-performance-workspace-id",
      "conversationId": "resettable-test-conversation-id",
      "channelId": "optional-channel-id"
    }
  ]
}
```

`userId`, `token`, `workspaceId` and `conversationId` are required. Two fields are optional:
`channelId`, which lets `zero-query-transform` add the channel-conversation read, and
`searchTerms` (an array of strings), which the `search` scenario uses instead of its built-in
generic terms. Supply `searchTerms` only if the terms are safe to commit to a Jenkins credential.

`attachmentIds` (an array of strings) is required by the `attachments` scenario and ignored by
every other one. Use small, non-confidential test files: each iteration transfers the real bytes
out of object storage, so a long run has a measurable egress cost. The scenario refuses to start
if the list is empty or an id is not retrievable, because a run against a missing id would
measure the not-found path instead of retrieval.

Never commit the real file, archive it in Jenkins, print it in logs, or use customer/production data.

## How many identities you need

The Zero endpoints are rate limited **per authenticated user**, not per connection —
`apps/backend/src/services/zeroRateLimiter.ts` counts requests against `authData.sub` and allows
`ZERO_MAX_REQUESTS` (default 300) per `ZERO_REQUEST_WINDOW` (default 60s). That is 5 requests per
second per identity.

A fixture that is too small means the run measures the rate limiter rather than the application,
and reports the limiter working correctly as a product failure. So `pnpm perf:run` **refuses** a
`zero-query-transform` run whose fixture cannot sustain the profile's peak rate:

| Profile | Peak VUs | Identities needed at 1s think time |
| --- | --- | --- |
| `smoke` | 1 | 1 |
| `release` | 25 | 5 |
| `load` | 100 | 20 |
| `stress` | 300 | 60 |
| `spike` | 300 | 60 |
| `soak` | 25 | 5 |

A longer `PERF_THINK_TIME_SECONDS` lowers the requirement proportionally. If the target has been
configured with a higher limit for the test window, pass the real value as
`PERF_ZERO_MAX_REQUESTS` so the guard sizes against the environment instead of the source default.

The `search` and `rest-messaging` scenarios go through `authMiddleware.authenticate` rather than
the Zero limiter, so they carry no identity floor — but spreading load across identities still produces more
realistic contention.

## Token lifetime

**Do not assume 24 hours.** `JWT_EXPIRATION_SECONDS` defaults to 86400, but a deployment can
issue far shorter tokens — sandbox was observed issuing **600-second** tokens on 2026-09-29.

Worse, the two auth paths disagree about what "expired" means:

| Path | Scenarios | Behaviour |
| --- | --- | --- |
| `authMiddleware.authenticate` | `search`, `attachments`, `rest-messaging` | Treats a token as expired when **under 5 minutes remain** (`auth.ts:346`) and 401s unless a `user_session_id` cookie is present to refresh it. |
| `authMiddleware.authenticateZero` | `zero-query-transform`, `zero-push` | Verifies the token directly, with no refresh window. |

So with a 600-second token the first group is usable for roughly five minutes. Any profile
longer than that — `release` at ~10m, `load` at ~40m, `soak` at ~4h — will start returning
401s part-way through and report them as failures.

**Before running those scenarios, confirm the identity's token lifetime comfortably exceeds
the profile duration**, or provision long-lived tokens or API keys for performance identities. The `zero-query-transform` scenario makes one authenticated request in `setup()` and fails fast as an `ENVIRONMENT_FAILURE` rather than letting the
run report a product regression.
