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
