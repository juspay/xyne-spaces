/**
 * Config keys that must NEVER be sourced from a (frontend-controlled) agentConfig
 * — not from an agent's stored config, and not from a per-request `/run` override.
 * These are platform secrets and internal service endpoints. If an agent could set
 * them, a crafted config could:
 *   - exfiltrate a platform secret (point a `*_URL` at an attacker host while the
 *     matching key still resolves from env, so the tool ships the secret there),
 *   - redirect internal service calls (SSRF), or
 *   - inject into a shell (`SSH_KEY_PATH` → `GIT_SSH_COMMAND` → `execSync`).
 * They resolve from env var / tool default only.
 *
 * SINGLE SOURCE OF TRUTH — consumed by both services so the list can't drift:
 *   - xyne-claw `resolveToolConfig` drops them when building a tool's config.
 *   - xyne-claw-auth `/run` forwarding strips them before sending to xyne-claw.
 */
export const PLATFORM_ONLY_CONFIG_KEYS: ReadonlySet<string> = new Set<string>([
  "XYNE_CLAW_S2S_KEY",
  "XYNE_CLAW_AUTH_URL",
  "CLAW_AUTH_URL",
  "KATA_ROUTER_URL",
  "KATA_NAMESPACE",
  "SSH_KEY_PATH",
  "LITELLM_URL",
  "LITELLM_BASE_URL",
  "LITELLM_API_KEY",
  "XYNE_AI_EXTENDED_URL",
  "XYNE_AI_EXTENDED_API_KEY",
  "GENIUS_API_URL",
  "QUERY_ROUTING_KEY",
  "IMAGE_GENERATION_ENDPOINT",
  "IMAGE_GENERATION_API_KEY",
  "PDF_BASE_URL",
  "PDF_API_KEY",
  "RESEARCH_AGENT_API_URL",
  "RESEARCH_AGENT_API_KEY",
  "SANDBOX_PW_ROUTER_URL",
  "GRAFANA_URL",
  "HINDSIGHT_URL",
  "HINDSIGHT_DATABASE_URL",
  "BITBUCKET_DASHBOARD_BASE_URL",
  "JENKINS_BASE_URL",
]);

/**
 * Return a shallow copy of `config` with every platform-only key removed, so a
 * frontend-controlled config can never override a platform env value. Safe on
 * null/undefined (returns an empty object).
 */
export function stripPlatformConfigKeys(
  config: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (!config) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (PLATFORM_ONLY_CONFIG_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}
