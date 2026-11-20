/**
 * Verifies the `x-service-assertion` header: ES256, typ xyne-service+jwt, an
 * issuer from the configured callers, audience xyne-claw-mcp, a lifetime of at
 * most 120 s, the request's method and path, the sha256 of the body (`bh`), and
 * a jti not seen before by this process.
 */
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { bodyHash, MCP_SERVICE_NAME } from "xyne-claw-mcp-common/protocol";

export const SERVICE_ASSERTION_HEADER = "x-service-assertion";
const SERVICE_ASSERTION_TYP = "xyne-service+jwt";

/** Caller service name → env var holding its public keys. */
export const CALLER_KEY_ENV = {
  "xyne-claw-encryption": "CLAW_ENCRYPTION_PUBLIC_KEYS",
  "xyne-claw-auth": "CLAW_SERVICE_PUBLIC_KEYS",
} as const;

export type CallerName = keyof typeof CALLER_KEY_ENV;
const MAX_LIFETIME_SECONDS = 120;
const CLOCK_SKEW_SECONDS = 30;
const JTI_TTL_MS = (MAX_LIFETIME_SECONDS + CLOCK_SKEW_SECONDS) * 1000;

export type AssertionError =
  | "missing"
  | "malformed"
  | "wrong-type"
  | "issuer-not-allowed"
  | "unknown-key"
  | "bad-signature"
  | "wrong-audience"
  | "expired"
  | "lifetime-too-long"
  | "not-bound-to-request"
  | "body-mismatch"
  | "replay";

/** `{"<kid>": "<SPKI PEM>"}` → P-256 public keys. Bad entries are dropped. */
export function parsePublicKeys(raw: string | undefined): Map<string, KeyObject> {
  const out = new Map<string, KeyObject>();
  if (!raw || !raw.trim()) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
  for (const [kid, pem] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof pem !== "string") continue;
    try {
      const key = createPublicKey(pem.replace(/\\n/g, "\n"));
      if (key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1") out.set(kid, key);
    } catch {
      // skip unparseable key
    }
  }
  return out;
}

function decodePart(part: string | undefined): Record<string, unknown> | null {
  if (!part) return null;
  try {
    const v = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Callers with public keys in env, limited to MCP_ALLOWED_CALLERS (comma list) when set. */
export function callerKeysFromEnv(env: NodeJS.ProcessEnv = process.env): Map<string, Map<string, KeyObject>> {
  const allowed = (env["MCP_ALLOWED_CALLERS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const out = new Map<string, Map<string, KeyObject>>();
  for (const [caller, envName] of Object.entries(CALLER_KEY_ENV)) {
    if (allowed.length > 0 && !allowed.includes(caller)) continue;
    const keys = parsePublicKeys(env[envName]);
    if (keys.size > 0) out.set(caller, keys);
  }
  return out;
}

export class AssertionVerifier {
  private readonly seen = new Map<string, number>();

  constructor(private readonly callers: Map<string, Map<string, KeyObject>>) {}

  get configured(): boolean {
    return this.callers.size > 0;
  }

  get callerNames(): string[] {
    return [...this.callers.keys()];
  }

  verify(
    raw: unknown,
    req: { method: string; path: string; body: Buffer | string },
    now = Math.floor(Date.now() / 1000),
  ): { caller: string } | AssertionError {
    if (typeof raw !== "string" || !raw.trim()) return "missing";
    const parts = raw.trim().split(".");
    if (parts.length !== 3 || !parts[2]) return "malformed";
    const header = decodePart(parts[0]);
    const payload = decodePart(parts[1]);
    if (!header || !payload) return "malformed";
    if (header["alg"] !== "ES256" || header["typ"] !== SERVICE_ASSERTION_TYP) return "wrong-type";
    const iss = typeof payload["iss"] === "string" ? payload["iss"] : "";
    const keys = this.callers.get(iss);
    if (!keys) return "issuer-not-allowed";
    const kid = typeof header["kid"] === "string" ? header["kid"] : "";
    const key = keys.get(kid);
    if (!key) return "unknown-key";
    const ok = verify(
      "sha256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(parts[2], "base64url"),
    );
    if (!ok) return "bad-signature";
    if (payload["aud"] !== MCP_SERVICE_NAME) return "wrong-audience";
    const iat = payload["iat"];
    const exp = payload["exp"];
    if (typeof iat !== "number" || typeof exp !== "number") return "malformed";
    if (exp - iat > MAX_LIFETIME_SECONDS) return "lifetime-too-long";
    if (exp < now - CLOCK_SKEW_SECONDS || iat > now + CLOCK_SKEW_SECONDS) return "expired";
    if (payload["htm"] !== req.method.toUpperCase() || payload["htu"] !== req.path.split("?")[0]) {
      return "not-bound-to-request";
    }
    if (payload["bh"] !== bodyHash(req.body)) return "body-mismatch";
    const jti = payload["jti"];
    if (typeof jti !== "string" || !jti) return "malformed";
    if (!this.claim(jti)) return "replay";
    return { caller: iss };
  }

  private claim(jti: string): boolean {
    const nowMs = Date.now();
    if (this.seen.size > 10_000) {
      for (const [id, expiresAt] of this.seen) if (expiresAt <= nowMs) this.seen.delete(id);
    }
    const expiresAt = this.seen.get(jti);
    if (expiresAt && expiresAt > nowMs) return false;
    this.seen.set(jti, nowMs + JTI_TTL_MS);
    return true;
  }
}
