const requiredEnv = (name: string): string => {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env: ${name}`);
  return val;
};

export const CONFIG = {
  port: Number(process.env["AUTH_SERVICE_PORT"] ?? 3003),
  selfUrl: process.env["AUTH_SERVICE_URL"] ?? `http://localhost:${process.env["AUTH_SERVICE_PORT"] ?? 3003}`,
  // Cluster-internal URL used for service-to-service callbacks (claw → claw-auth)
  // and self-dispatch (claw-auth → its own /run). Setting this to the in-cluster
  // K8s service DNS keeps the high-volume /webhook/progress + /webhook/result
  // traffic off the public ingress (~100k+ progress events/day in prod).
  // Falls back to `selfUrl` so single-node / dev deployments keep working.
  internalUrl: process.env["AUTH_SERVICE_INTERNAL_URL"] ?? process.env["AUTH_SERVICE_URL"] ?? `http://localhost:${process.env["AUTH_SERVICE_PORT"] ?? 3003}`,
  encryptionKey: Buffer.from(requiredEnv("ENCRYPTION_KEY"), "hex"),
  // Spaces' AES-256-CBC key — must equal xyne-spaces backend's ENCRYPTION_KEY
  // value (the two services are independently keyed). Used ONLY to decrypt
  // `installed_apps.signingSecret` read from the Spaces DB during the
  // signing-secret backfill. Empty buffer when unset; the backfill
  // short-circuits with a clear error if it needs this and it's missing.
  spacesEncryptionKey: process.env["SPACES_ENCRYPTION_KEY"]
    ? Buffer.from(process.env["SPACES_ENCRYPTION_KEY"]!, "hex")
    : Buffer.alloc(0),
  xyneClawUrl: process.env["XYNE_CLAW_URL"] ?? "http://localhost:3002",
  xyneClawS2sKey: process.env["XYNE_CLAW_S2S_KEY"] ?? "",
  xyneSpacesCallbackUrl: process.env["XYNE_SPACES_CALLBACK_URL"] ?? "",
  spacesBackendUrl: process.env["SPACES_BACKEND_URL"] ?? "http://localhost:3001",
  // Cluster-internal Spaces URL — used for high-volume server-to-server API
  // calls (auth/me on every authenticated request, chat/postMessage on every
  // agent response, chat/agentProgress on every progress tick). Keeps the
  // public ingress out of the path. Falls back to spacesBackendUrl so dev /
  // single-node deploys keep working without setting two envs.
  spacesInternalUrl: process.env["SPACES_INTERNAL_URL"] ?? process.env["SPACES_BACKEND_URL"] ?? "http://localhost:3001",
  /**
   * Read-only Postgres connection string to the Spaces DB. When set, claw-auth
   * fetches fresh user session credentials (token, sessionId, workspaceId)
   * directly from `workflow.user_sessions` at MCP-spawn time instead of relying
   * on the stale cached copy in `userMcpConnection`. Recommended Postgres role:
   *
   *   CREATE ROLE claw_readonly WITH LOGIN PASSWORD '…';
   *   GRANT CONNECT ON DATABASE spaces TO claw_readonly;
   *   GRANT USAGE ON SCHEMA public, workflow TO claw_readonly;
   *   GRANT SELECT ON public.users, workflow.user_sessions TO claw_readonly;
   *
   * If unset, claw-auth falls back to the stored credentials path (same
   * behavior as today). Empty value = feature off.
   */
  spacesDbUrl: process.env["SPACES_DB_URL"] ?? "",
  // Public user-facing Spaces URL — used for citation links + ticket deep links
  // (anything a human will click). PUBLIC_SPACES_URL is the canonical env;
  // older deployments may still set SPACES_APP_URL / VITE_XYNE_BACKEND_URL /
  // SPACES_BACKEND_URL, so those remain in the fallback chain. Default is the
  // production public domain — dev environments set one of the existing envs
  // to point at localhost as usual.
  spacesAppUrl: process.env["PUBLIC_SPACES_URL"]
    ?? process.env["SPACES_APP_URL"]
    ?? process.env["VITE_XYNE_BACKEND_URL"]
    ?? process.env["SPACES_BACKEND_URL"]
    ?? "https://app.spaces.xyne.juspay.net",
  defaultAgentSlug: process.env["DEFAULT_AGENT_SLUG"] ?? "assistant",
  minCronIntervalMinutes: Number(process.env["MIN_CRON_INTERVAL_MINUTES"] ?? 30),
  redisHost: process.env["REDIS_HOST"] ?? "localhost",
  redisPort: Number(process.env["REDIS_PORT"] ?? 6379),
  redisPassword: process.env["REDIS_PASSWORD"] || undefined,
  redisTls: process.env["REDIS_TLS"] === "true",
  runRecoveryMaxRetries: Number(process.env["RUN_RECOVERY_MAX_RETRIES"] ?? 3),
  runRecoveryTimeoutMs: Number(process.env["RUN_RECOVERY_TIMEOUT_MS"] ?? 900000),
  runRecoveryBackoffMs: Number(process.env["RUN_RECOVERY_BACKOFF_MS"] ?? 30000),
  gcsProjectId: process.env["GCS_PROJECT_ID"] ?? "",
  gcsBucketName: process.env["GCS_BUCKET_NAME"] ?? "xyne-claw-chat-attachments",
  fakeGcsHost: process.env["FAKE_GCS_HOST"] ?? "",
  /**
   * Bitbucket Server creds used by the admin dashboard to count PRs/commits
   * authored by the xyne-doctor bot identity (`john.doe@gmail.com`).
   *
   * All values are optional. If `BITBUCKET_DASHBOARD_TOKEN` is unset, the
   * dashboard endpoint returns `{ prsCreated: null, ..., reason: "bitbucket_token_missing" }`
   * and the UI shows a "Bitbucket not configured" empty state instead of erroring.
   *
   * Required permissions on the token: REPO_READ on the configured project/repo.
   * No write/admin scopes needed — this is a read-only analytics integration.
   */
  bitbucketDashboardUsername: process.env["BITBUCKET_DASHBOARD_USERNAME"] ?? "",
  bitbucketDashboardToken: process.env["BITBUCKET_DASHBOARD_TOKEN"] ?? "",
  bitbucketDashboardBaseUrl: (process.env["BITBUCKET_DASHBOARD_BASE_URL"] ?? "https://bitbucket.example.com").replace(/\/+$/, ""),
  bitbucketDashboardProjectKey: process.env["BITBUCKET_DASHBOARD_PROJECT_KEY"] ?? "XYNE",
  bitbucketDashboardRepoSlug: process.env["BITBUCKET_DASHBOARD_REPO_SLUG"] ?? "xyne-spaces",
  bitbucketDashboardAuthorEmail: process.env["BITBUCKET_DASHBOARD_AUTHOR_EMAIL"] ?? "john.doe@gmail.com",
  bitbucketDashboardAuthorUsername: process.env["BITBUCKET_DASHBOARD_AUTHOR_USERNAME"] ?? "xyne.spaces",
  bitbucketDashboardCacheTtlMs: Number(process.env["BITBUCKET_DASHBOARD_CACHE_TTL_MS"] ?? 15 * 60 * 1000),
  bitbucketDashboardBackgroundRefresh: process.env["BITBUCKET_DASHBOARD_BACKGROUND_REFRESH"] !== "false",
  /**
   * BITBOT — Juspay PR-analysis service. The MCP adapter spawns a stdio
   * child (servers/bitbot-server.ts) that POSTs to {bitbotBaseUrl}/api/prs/bulk
   * to fetch PRs across Bitbucket repos. Access is gated by NAT-IP allowlist
   * on the pr-analysis side, so no token is required.
   *
   * Default is the externally-resolvable AWS-ALB-fronted hostname so the
   * service works from anywhere with allowlisted egress. Override
   * BITBOT_BASE_URL to point at a proxy / staging / in-cluster DNS.
   *
   * Trailing slashes stripped so endpoint joining stays trivial.
   */
  bitbotBaseUrl: (
    process.env["BITBOT_BASE_URL"] ??
    "<research-agent-url>"
  ).replace(/\/+$/, ""),
} as const;
