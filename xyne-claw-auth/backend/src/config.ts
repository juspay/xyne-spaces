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
  // Public base URL of the claw SPA, used for post-OAuth browser redirects.
  // Precedence: explicit FRONTEND_URL override; else in production the SPA is
  // served under /claw/ on the auth service's public host; in development it
  // runs on vite's own port. Always normalized to a trailing slash.
  frontendUrl: (() => {
    const configured = process.env["FRONTEND_URL"]
      ?? (process.env["NODE_ENV"] === "production"
        ? `${(process.env["AUTH_SERVICE_URL"] ?? "").replace(/\/+$/, "")}/claw/`
        : "http://localhost:5174/claw/");
    return configured.endsWith("/") ? configured : `${configured}/`;
  })(),
  xyneClawS2sKey: process.env["XYNE_CLAW_S2S_KEY"] ?? "",
  azureTtsEndpoint: (process.env["AZURE_TTS_ENDPOINT"] ?? "").replace(/\/+$/, ""),
  azureTtsApiKey: process.env["AZURE_TTS_API_KEY"] ?? "",
  azureTtsApiVersion: process.env["AZURE_TTS_API_VERSION"] ?? "",
  azureTtsDeployment: process.env["AZURE_TTS_DEPLOYMENT"] ?? "",
  azureTtsVoice: process.env["AZURE_TTS_VOICE"] || "shimmer",
  // Platform LiteLLM proxy base URL. Default endpoint the agent-level "litellm"
  // provider lists models from (and, at run time, the runtime falls back to
  // when a credential omits its own baseUrl). Owners bringing their own LiteLLM
  // key that lives on the platform proxy can leave the credential's baseUrl
  // blank and hit this. Trailing slashes stripped so `${base}/v1/models` joins
  // cleanly.
  litellmBaseUrl: (process.env["LITELLM_BASE_URL"] ?? "https://grid.ai.example.com").replace(/\/+$/, ""),
  /**
   * Flip the claw → claw-auth transport from per-chunk HTTP POSTs to a single
   * SSE stream. When on, run-stream.ts opens an SSE connection to claw's
   * /internal/run and dispatches frames into the same pendingStreams /
   * agentRunRepository wiring the legacy /progress handler used; the SSE
   * response we write to the FRONTEND is byte-identical. Off → legacy POST
   * path, preserved as the rollback.
   *
   * Accepts: "1", "true", "on", "yes" (case-insensitive). Default OFF until
   * deployed callers can verify SSE locally.
   */
  clawSseTransport: ["1", "true", "on", "yes"].includes(
    (process.env["CLAW_SSE_TRANSPORT"] ?? "").trim().toLowerCase(),
  ),
  cliTokensEnabled: ["1", "true", "on", "yes"].includes(
    (process.env["CLI_TOKENS_ENABLED"] ?? "").trim().toLowerCase(),
  ),
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
  // Fan out live run events (tool calls + progress labels) to v3 chat viewers
  // over Redis pub/sub + an SSE endpoint. ON by default; set
  // LIVE_TOOLCALLS_ENABLED=false to disable.
  liveToolCallsEnabled: process.env["LIVE_TOOLCALLS_ENABLED"] !== "false",
  runRecoveryMaxRetries: Number(process.env["RUN_RECOVERY_MAX_RETRIES"] ?? 3),
  // Must be > SESSION_LOCK_TTL_MS (15 min in xyne-claw) — when equal, a slow but
  // progressing run keeps refreshing its lock on every message_end while the
  // watchdog fires on the same cadence, so every recovery retry lands inside a
  // still-locked window and burns through maxRetries before the original run
  // releases (incident 2026-06-09 euler-doctor session dea1f67c).
  runRecoveryTimeoutMs: Number(process.env["RUN_RECOVERY_TIMEOUT_MS"] ?? 1_200_000),
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
   * Direct Vespa search — bypasses the Spaces backend /api/vespaSearch entirely.
   * When enabled the spaces-search MCP tool builds and executes YQL against Vespa
   * directly from claw-auth without a backend round-trip.
   *
   * Required companion env vars:
   *   VESPA_QUERY_ENDPOINT  e.g. http://vespa:8081   (Vespa query port)
   *   VESPA_NAMESPACE       e.g. namespace            (matches Spaces backend)
   *   VESPA_CLUSTER         e.g. my_content           (matches Spaces backend)
   */
  directVespaSearch: ["1", "true", "on", "yes"].includes(
    (process.env["DIRECT_VESPA_SEARCH"] ?? "").trim().toLowerCase(),
  ),
  vespaQueryEndpoint: (process.env["VESPA_QUERY_ENDPOINT"] ?? "http://localhost:8081").replace(/\/+$/, ""),
  /**
   * Vespa FEED endpoint (document API). Separate from vespaQueryEndpoint
   * because Spaces splits them (VESPA_FEED_URL / VESPA_QUERY_URL) even though
   * they are usually the same container port. Used only by the
   * entity-extraction type write-back; defaults to the query endpoint.
   */
  vespaFeedEndpoint: (process.env["VESPA_FEED_ENDPOINT"] ?? process.env["VESPA_QUERY_ENDPOINT"] ?? "http://localhost:8080").replace(/\/+$/, ""),
  vespaNamespace: process.env["VESPA_NAMESPACE"] ?? "namespace",
  vespaCluster: process.env["VESPA_CLUSTER"] ?? "my_content",
  /**
   * Pause (ms) the search-eval-run-worker inserts after each row's Vespa
   * query, in BOTH permission modes — a large sheet (hundreds/thousands of
   * rows) run at full QUERY_CONCURRENCY would otherwise hammer the Vespa
   * pod with sustained parallel query load. Default 500ms.
   */
  searchEvalQueryDelayMs: Number(process.env["SEARCH_EVAL_QUERY_DELAY_MS"] ?? 500),
  /**
   * Entity extraction — reads a channel's threads/tickets out of Vespa and
   * discovers the entity types the org talks about. The completions run on
   * xyne-claw (see services/entityExtraction/entityLlmClient.ts), so the model
   * name is configured on claw; only the read/fan-out limits live here.
   */
  entityExtraction: {
    /** Hard cap on threads read per channel. Bounds a run's cost and duration. */
    maxThreadsPerChannel: Number(process.env["ENTITY_EXTRACTION_MAX_THREADS"] ?? 400),
    /**
     * Parallel LLM calls in flight. A single extraction call takes 20-75s on
     * this endpoint, and the LiteLLM key's max_parallel_requests slots are
     * shared with live agent runs — raising this makes calls contend and time
     * out rather than finish faster.
     */
    concurrency: Number(process.env["ENTITY_EXTRACTION_CONCURRENCY"] ?? 2),
    /**
     * Org-level framing prepended to the type-discovery prompts, so the model
     * knows whose data it is reading. Fixes identity-relative errors like
     * listing the org itself as an external ORGANISATION, and sharpens ORG vs
     * MERCHANT.
     */
    orgContext:
      process.env["ENTITY_EXTRACTION_ORG_CONTEXT"] ??
      "The data belongs to Juspay, a payments orchestration company. Juspay routes and " +
        "processes online transactions for its merchant clients across many payment gateways, " +
        "payment methods, card networks and banks. MERCHANTS are Juspay customers who use it to " +
        "accept payments. Payment gateways/PSPs, card networks, banks and regulators such as NPCI " +
        "are external ecosystem entities. Juspay itself is the operator, NOT an external " +
        "organisation — never classify Juspay (or its own products/teams) as ORGANISATION.",
  },
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

  researchAgentBaseUrl: (
    process.env["RESEARCH_AGENT_BASE_URL"] ??
    "<research-agent-url>"
  ).replace(/\/+$/, ""),
  /** API key for Research Agent */
  researchAgentApiKey: process.env["RESEARCH_AGENT_API_KEY"] ?? "",
  /** API key used by the global research-agent-mcp stdio proxy. */
  researchAgentMcpApiKey: process.env["RESEARCH_AGENT_MCP_API_KEY"]
    ?? process.env["research_agent_mcp_api_key"]
    ?? "",
} as const;

// Grafana → error auto-fix pipeline (lives here — claw stays stateless; the
// queues + fix records ride this service's existing Redis).
export const ERROR_PIPELINE = {
  jwtSecret: process.env["ERROR_PIPELINE_JWT_SECRET"] ?? "",
  isRunnerPod: (process.env["ERROR_PIPELINE_RUNNER_POD"] ?? "false") === "true",
  itemTimeoutMs: 60 * 60 * 1000,
  maxAttempts: 3,
  dedupTtlSeconds: 2 * 24 * 60 * 60,
  maxStreamLen: 1000,
  runnerPollMs: 3000,
  agentSlug: process.env["ERROR_PIPELINE_AGENT_SLUG"] ?? "doctor-agent",
  // Identity the agent runs as; resolved from the agent row
  agentUserId: process.env["ERROR_PIPELINE_AGENT_USER_ID"] ?? "",
  agentTimeoutMs: 30 * 60 * 1000,
} as const;
