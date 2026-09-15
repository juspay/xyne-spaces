export const SERVER = {
  port: Number(process.env["XYNE_CLAW_PORT"] ?? 3002),
  s2sKey: process.env["XYNE_CLAW_S2S_KEY"] ?? "",
  authServiceUrl: process.env["XYNE_CLAW_AUTH_URL"] ?? "http://localhost:3003",
} as const;

// SSRF guard for caller-supplied callback/progress URLs. These arrive in the
// /run body and are always set by claw-auth to its own internal origin
// (= authServiceUrl). We never fetch a callback/progress target that isn't that
// exact origin, so a leaked S2S key can't turn the callback into an SSRF
// primitive against cloud metadata / internal services. Extra origins can be
// added via XYNE_CLAW_CALLBACK_ORIGINS (comma-separated) if a second internal
// host ever needs to receive callbacks.
const ALLOWED_CALLBACK_ORIGINS: ReadonlySet<string> = (() => {
  const origins = new Set<string>();
  for (const candidate of [SERVER.authServiceUrl, ...(process.env["XYNE_CLAW_CALLBACK_ORIGINS"] ?? "").split(",")]) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    try { origins.add(new URL(trimmed).origin); } catch { /* ignore malformed */ }
  }
  return origins;
})();

export function isAllowedCallbackUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return ALLOWED_CALLBACK_ORIGINS.has(u.origin);
  } catch {
    return false;
  }
}

export const PATHS = {
  dataDir: process.env["XYNE_CLAW_DATA_DIR"] ?? "./data",
  agentDir: process.env["XYNE_CLAW_AGENT_DIR"] ?? "",
} as const;

const litellmModel = process.env["LITELLM_MODEL"]?.trim() || "kimi-latest";
const litellmFastModel = process.env["LITELLM_FAST_MODEL"]?.trim() || litellmModel;

export const LITELLM = {
  url: process.env["LITELLM_URL"] ?? "http://localhost:4000",
  apiKey: process.env["LITELLM_API_KEY"] ?? "",
  // Separate low-priority key for non-interactive load: automation/scheduled
  // agent runs and background curators. Keeps batch traffic from saturating
  // the interactive key's max_parallel_requests pool (prod incident 2026-07-29:
  // email-followup-classifier + curators pinned the shared key at 50/50 slots,
  // queueing human mentions for minutes). Falls back to the main key so the
  // split can deploy before the second key is provisioned.
  automationApiKey: process.env["LITELLM_AUTOMATION_API_KEY"]?.trim() || (process.env["LITELLM_API_KEY"] ?? ""),
  // Optional cheaper/faster model for automation/scheduled runs. Falls back to
  // the main model, and a per-agent modelSettings.model still wins over this —
  // it only replaces the PLATFORM DEFAULT for batch traffic.
  automationModel: process.env["LITELLM_AUTOMATION_MODEL"]?.trim() || litellmModel,
  model: litellmModel,
  // Cheap-and-fast model used by judge/boss roles (chain-judge, goal-judge).
  // Boss decisions are short structured calls; running them on the same big
  // model as the worker would double the per-turn cost for marginal quality.
  fastModel: litellmFastModel,
} as const;

export const AGENT = {
  thinkingLevel: process.env["XYNE_CLAW_THINKING"] ?? "medium",
} as const;

// Session archive / attachment storage.
export const GCS = {
  // Keep the default in sync with claw-auth config (CONFIG.gcsBucketName).
  bucketName: process.env["GCS_BUCKET_NAME"] ?? "xyne-claw-chat-attachments",
  // Local dev points at the fake-gcs-server from docker-compose.dev.yml instead
  // of real GCS — same env var and dev-only gate as claw-auth's gcsService, so
  // both services talk to the same emulator. Without it, ensureFreshSession
  // can't verify the archive against real GCS (no/expired ADC) and rejects
  // every run with SessionRestoreFailedError before the agent starts. Always
  // empty in production, where the SDK uses ADC / Workload Identity.
  fakeHost: normalizeFakeGcsHost(),
} as const;

/**
 * Object storage provider selection — 'gcs' (default) or 's3'. Consumed by
 * storage.ts via the shared @xyne/storage factory. Env names match the Spaces
 * backend (config/env.ts) and claw-auth so one set of envs configures all
 * three apps: STORAGE_PROVIDER, AWS_REGION, AWS_ACCESS_KEY_ID,
 * AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME, S3_ENDPOINT.
 */
export const STORAGE = {
  provider: (process.env["STORAGE_PROVIDER"] === "s3" ? "s3" : "gcs") as "gcs" | "s3",
  s3Region: process.env["AWS_REGION"] ?? "ap-south-1",
  s3BucketName: process.env["S3_BUCKET_NAME"] ?? GCS.bucketName,
  s3Endpoint: process.env["S3_ENDPOINT"] ?? "",
  s3AccessKeyId: process.env["AWS_ACCESS_KEY_ID"] ?? "",
  s3SecretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"] ?? "",
} as const;

function normalizeFakeGcsHost(): string {
  if (process.env["NODE_ENV"] === "production") return "";
  const raw = process.env["FAKE_GCS_HOST"]?.trim() ?? "";
  if (!raw) return "";
  return raw.startsWith("http") ? raw : `http://${raw}`;
}

// When set, claw publishes a one-shot progress event with a noVNC preview URL
// the moment a sandbox session is acquired, so claw-auth can post a clickable
// link into the Spaces channel where the user can watch (and drive) the
// agent's headed chromium-B over noVNC. Path mode in sandbox-router-ws:
//   ${baseUrl}/claw-preview/<sandboxId>/  →  redirects to vnc.html?autoconnect=…
// Empty string disables the announce.
export const SANDBOX_PREVIEW = {
  baseUrl: process.env["SANDBOX_PREVIEW_BASE_URL"] ?? "https://app.spaces.xyne.juspay.net",
} as const;

// Hindsight long-term memory.
//
// When HINDSIGHT_URL is set, xyne-claw prefetches relevant memories at the
// start of each session (injected as PromptInjection items) and queues
// completed sessions for nightly retain (written to data/memory-queue/).
//
// The nightly cron in xyne-claw-auth reads the queue at 2 AM IST, calls
// hindsight.retain() for each session, and routes new memories through the
// agent's configured memoryApprovalStrategy (HUMAN_ONLY | EVALS_ONLY |
// EVALS_THEN_HUMAN). Leave HINDSIGHT_URL empty to disable memory entirely.
export const HINDSIGHT = {
  url: process.env["HINDSIGHT_URL"] ?? "",
  tenant: process.env["HINDSIGHT_TENANT"] ?? "default",
  apiKey: process.env["HINDSIGHT_API_KEY"] ?? "",
  // Mirror claw-auth's gate (memoryCronService.ts): MEMORY_PROVIDER alone also
  // enables memory (e.g. MEMORY_PROVIDER=stub in dev). Previously only
  // HINDSIGHT_URL counted here, so a deployment configured via MEMORY_PROVIDER
  // could retain memories through claw-auth while every memory-search call on
  // this pod returned "not configured" — a silent split-brain.
  enabled: Boolean(process.env["HINDSIGHT_URL"] || process.env["MEMORY_PROVIDER"]),
} as const;
