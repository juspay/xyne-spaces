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

export const LITELLM = {
  url: process.env["LITELLM_URL"] ?? "http://localhost:4000",
  apiKey: process.env["LITELLM_API_KEY"] ?? "",
  model: process.env["LITELLM_MODEL"] ?? "claude-sonnet-4-20250514",
  // Cheap-and-fast model used by judge/boss roles (chain-judge, goal-judge).
  // Boss decisions are short structured calls; running them on the same big
  // model as the worker would double the per-turn cost for marginal quality.
  fastModel: process.env["LITELLM_FAST_MODEL"] ?? "open-large",
} as const;

export const AGENT = {
  thinkingLevel: process.env["XYNE_CLAW_THINKING"] ?? "medium",
} as const;

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
  enabled: Boolean(process.env["HINDSIGHT_URL"]),
} as const;
