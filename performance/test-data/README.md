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

`userId`, `token`, `workspaceId` and `conversationId` are required. `channelId` is optional: the
`zero-query-transform` scenario adds the channel-conversation read only for identities that supply one.

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
| `soak` | 25 | 5 |

A longer `PERF_THINK_TIME_SECONDS` lowers the requirement proportionally. If the target has been
configured with a higher limit for the test window, pass the real value as
`PERF_ZERO_MAX_REQUESTS` so the guard sizes against the environment instead of the source default.

The `rest-messaging` scenario goes through `authMiddleware.authenticate` rather than the Zero
limiter, so it carries no identity floor — but spreading load across identities still produces more
realistic contention.

## Token lifetime

`JWT_EXPIRATION_SECONDS` defaults to 86400 (24h), so a 4h `soak` is fine with freshly minted
tokens. A stale fixture produces 401s part-way through a run. The `zero-query-transform` scenario makes one authenticated request in `setup()` and fails fast as an `ENVIRONMENT_FAILURE` rather than letting the
run report a product regression.
