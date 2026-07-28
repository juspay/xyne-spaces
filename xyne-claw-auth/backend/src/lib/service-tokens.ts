/**
 * Service access tokens — org-admin-minted bearers for unattended external
 * callers (servers hitting /run), as opposed to the personal device-flow
 * tokens in cli-tokens.ts. Same storage row (SurfaceAccessToken, client:
 * "service"), same hash/verify protocol (cli-tokens.ts stays the single
 * validation path for ALL xyne_* bearers) — this module owns only what is
 * service-token-specific: generation and the default scope set.
 *
 * Mint/list/revoke endpoints live in routes/organizations.ts.
 */

import { randomBytes } from "node:crypto";
import { SERVICE_TOKEN_PREFIX, hash } from "./cli-tokens.js";

/** Default scopes stamped on minted service tokens (informational in v1). */
export const SERVICE_TOKEN_SCOPES = ["agents:read", "runs:read", "runs:write"];

export function generateServiceToken(): { raw: string; hashed: string; prefix: string } {
  const raw = `${SERVICE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    raw,
    hashed: hash(raw),
    prefix: raw.slice(0, 12),
  };
}

// ── Scope enforcement (v2: scopes are real, not informational) ────────────

/**
 * Agent-restriction scopes: a service token may only invoke agents named by
 * an `agent:<slug>` scope. A token with NO agent scopes can invoke nothing —
 * minting requires an explicit allowlist, so a leaked token's blast radius
 * is always bounded to the agents it was created for.
 */
export const AGENT_SCOPE_PREFIX = "agent:";

export function agentScope(slug: string): string {
  return `${AGENT_SCOPE_PREFIX}${slug}`;
}

/**
 * Wildcard scope: the token may invoke EVERY agent in its org, including
 * agents created after the token was minted. Deliberately not offered by the
 * mint UI — an admin grants it explicitly (SQL/admin tooling) when a caller
 * genuinely needs org-wide access, accepting the wider blast radius.
 */
export const ALL_AGENTS_SCOPE = `${AGENT_SCOPE_PREFIX}*`;

export function agentScopeAllows(scopes: string[], slug: string): boolean {
  return scopes.includes(ALL_AGENTS_SCOPE) || scopes.includes(agentScope(slug));
}

/**
 * The /run request-body contract for external (service-token) callers.
 * Everything else the internal dispatch paths accept — provider overrides,
 * eventType, cwd, progressUrl, session plumbing — is stripped BEFORE the
 * handler destructures the body, so external traffic can never masquerade
 * as internal traffic. Stripped, not rejected: tightening this list must
 * not break existing integrators.
 */
export const EXTERNAL_RUN_BODY_FIELDS = [
  "task",
  "agentSlug",
  "conversationId",
  "context",
  "callbackUrl",
  "callbackSecret",
  "attachments",
  "idempotencyKey",
  "detached",
  "triggerSource",
  "userId",
] as const;

export function sanitizeExternalRunBody(
  body: Record<string, unknown>,
): { sanitized: Record<string, unknown>; dropped: string[] } {
  const allowed = new Set<string>(EXTERNAL_RUN_BODY_FIELDS);
  const sanitized: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (allowed.has(key)) sanitized[key] = value;
    else dropped.push(key);
  }
  return { sanitized, dropped };
}
