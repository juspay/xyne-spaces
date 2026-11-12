/**
 * Service-to-service authentication without a shared key (runtime side).
 *
 * The runtime signs its calls to claw-auth with its own ES256 key
 * (CLAW_RUNTIME_PRIVATE_KEY); claw-auth holds only the public key. claw-auth's
 * calls to the runtime are verified with claw-auth's public key
 * (CLAW_SERVICE_PUBLIC_KEYS). User identity never comes from a header: on
 * run-scoped calls it comes from the run's session token, which claw-auth issued.
 *
 * Header `x-service-assertion: <JWT>`, typ "xyne-service+jwt", ES256, kid.
 * Claims { iss <service>, aud <service>, htm, htu (path, no query), iat, exp ≤ 60 s, jti }.
 *
 * The private key stays in this process: tools and sandboxes get a signing
 * function (serviceAuthHeaders), never the key.
 */

import { createPrivateKey, createPublicKey, randomUUID, sign, verify, type KeyObject } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ownershipClient } from "./run-ownership.js";
import { createLogger } from "./logger.js";

const log = createLogger("service-assertion");

export type ServiceName = "xyne-spaces" | "xyne-claw-auth" | "xyne-claw";
export const SELF: ServiceName = "xyne-claw";
export const SERVICE_ASSERTION_HEADER = "x-service-assertion";
export const SERVICE_ASSERTION_TYP = "xyne-service+jwt";

const LIFETIME_SECONDS = 60;
const MAX_LIFETIME_SECONDS = 120;
const CLOCK_SKEW_SECONDS = 30;
const JTI_TTL_SECONDS = MAX_LIFETIME_SECONDS + CLOCK_SKEW_SECONDS;

const b64url = (b: Buffer | string) => (typeof b === "string" ? Buffer.from(b, "utf8") : b).toString("base64url");
const isP256 = (k: KeyObject) => k.asymmetricKeyType === "ec" && k.asymmetricKeyDetails?.namedCurve === "prime256v1";
const pemFromEnv = (name: string) => (process.env[name] ?? "").replace(/\\n/g, "\n").trim();

// ── Signing ──────────────────────────────────────────────────────────────────

let signingCache: { pem: string; key: KeyObject | null } | null = null;

function signingKey(): KeyObject | null {
  const pem = pemFromEnv("CLAW_RUNTIME_PRIVATE_KEY");
  if (signingCache && signingCache.pem === pem) return signingCache.key;
  let key: KeyObject | null = null;
  if (pem) {
    try {
      const k = createPrivateKey(pem);
      if (isP256(k)) key = k;
      else log.error("[service-assertion] CLAW_RUNTIME_PRIVATE_KEY must be an EC P-256 key");
    } catch (err) {
      log.error("[service-assertion] CLAW_RUNTIME_PRIVATE_KEY could not be parsed:", err instanceof Error ? err.message : err);
    }
  }
  signingCache = { pem, key };
  return key;
}

export function serviceSigningConfigured(): boolean {
  return signingKey() !== null;
}

/** One-shot assertion from the runtime to `aud` for `method path`. Throws when no key is configured. */
export function signServiceAssertion(aud: ServiceName, method: string, path: string): string {
  const key = signingKey();
  if (!key) throw new Error("CLAW_RUNTIME_PRIVATE_KEY not configured");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", typ: SERVICE_ASSERTION_TYP, kid: process.env["CLAW_RUNTIME_KEY_ID"] || "runtime-1" };
  const payload = { iss: SELF, aud, iat: now, exp: now + LIFETIME_SECONDS, jti: randomUUID(), htm: method.toUpperCase(), htu: path.split("?")[0] };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  return `${input}.${b64url(sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }))}`;
}

/**
 * Headers proving the runtime is calling `url` with `method` (default claw-auth).
 * Pass a run's session token as `sessionToken` for run-scoped calls; claw-auth
 * takes the user from it, never from x-user-id.
 */
export function serviceAuthHeaders(method: string, url: string, opts: { aud?: ServiceName; sessionToken?: string } = {}): Record<string, string> {
  const path = /^https?:\/\//i.test(url) ? new URL(url).pathname : (url.split("?")[0] ?? url);
  return {
    [SERVICE_ASSERTION_HEADER]: signServiceAssertion(opts.aud ?? "xyne-claw-auth", method, path),
    ...(opts.sessionToken ? { "x-session-token": opts.sessionToken } : {}),
  };
}

/** A signer to hand to tools: they can authenticate a call but never see the key. */
export type ServiceHeaderSigner = (method: string, url: string) => Record<string, string>;
export function signerFor(sessionToken?: string): ServiceHeaderSigner {
  return (method, url) => serviceAuthHeaders(method, url, sessionToken ? { sessionToken } : {});
}

// ── Verifying (claw-auth calling the runtime) ────────────────────────────────

const keyCache = new Map<string, Map<string, KeyObject>>();

function keySet(envName: string): Map<string, KeyObject> {
  const raw = process.env[envName] ?? "";
  const hit = keyCache.get(`${envName}\u0000${raw}`);
  if (hit) return hit;
  const keys = new Map<string, KeyObject>();
  try {
    const parsed = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
    for (const [kid, pem] of Object.entries(parsed)) {
      if (typeof pem !== "string") continue;
      try {
        const k = createPublicKey(pem.replace(/\\n/g, "\n"));
        if (isP256(k)) keys.set(kid, k);
      } catch {
        log.error(`[service-assertion] ${envName} entry ${kid} could not be parsed`);
      }
    }
  } catch {
    log.error(`[service-assertion] ${envName} is not valid JSON`);
  }
  keyCache.set(`${envName}\u0000${raw}`, keys);
  return keys;
}

const ISSUER_KEY_ENV: Partial<Record<ServiceName, string>> = {
  "xyne-claw-auth": "CLAW_SERVICE_PUBLIC_KEYS",
  "xyne-spaces": "SPACES_DELEGATION_PUBLIC_KEYS",
};

/** Public key allowed to sign as `iss` with `kid`. The runtime's own pods verify each other with its own key. */
function issuerKey(iss: ServiceName, kid: string): KeyObject | undefined {
  if (iss === SELF) {
    const own = signingKey();
    return own && kid === (process.env["CLAW_RUNTIME_KEY_ID"] || "runtime-1") ? createPublicKey(own) : undefined;
  }
  const envName = ISSUER_KEY_ENV[iss];
  return envName ? keySet(envName).get(kid) : undefined;
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

export function verifyServiceAssertion(
  raw: unknown,
  opts: { allow: readonly ServiceName[]; method: string; path: string; now?: number },
): { iss: ServiceName; jti: string } | string {
  if (typeof raw !== "string" || !raw.trim()) return "missing";
  const parts = raw.trim().split(".");
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (parts.length !== 3 || !header || !payload || !parts[2]) return "malformed";
  if (header["alg"] !== "ES256" || header["typ"] !== SERVICE_ASSERTION_TYP) return "wrong-type";
  const iss = payload["iss"];
  if (typeof iss !== "string" || !(opts.allow as readonly string[]).includes(iss)) return "issuer-not-allowed";
  const kid = typeof header["kid"] === "string" ? header["kid"] : "";
  const key = kid ? issuerKey(iss as ServiceName, kid) : undefined;
  if (!key) return "unknown-key";
  if (!verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2], "base64url"))) return "bad-signature";
  if (payload["aud"] !== SELF) return "wrong-audience";
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const iat = payload["iat"];
  const exp = payload["exp"];
  if (typeof iat !== "number" || typeof exp !== "number") return "malformed";
  if (exp - iat > MAX_LIFETIME_SECONDS) return "lifetime-too-long";
  if (exp < now - CLOCK_SKEW_SECONDS || iat > now + CLOCK_SKEW_SECONDS) return "expired";
  if (payload["htm"] !== opts.method.toUpperCase() || payload["htu"] !== opts.path.split("?")[0]) return "not-bound-to-request";
  const jti = payload["jti"];
  if (typeof jti !== "string" || !jti) return "malformed";
  return { iss: iss as ServiceName, jti };
}

const localSeen = new Map<string, number>();

/** Each assertion once. Redis when configured (fails closed if it errors); per-process otherwise (local dev). */
async function claimJti(jti: string): Promise<"fresh" | "replay" | "unavailable"> {
  const redis = ownershipClient();
  if (redis) {
    try {
      return (await redis.set(`service-assertion:${jti}`, "1", "EX", JTI_TTL_SECONDS, "NX")) === "OK" ? "fresh" : "replay";
    } catch (err) {
      log.error("[service-assertion] replay check unavailable (Redis):", err instanceof Error ? err.message : err);
      return "unavailable";
    }
  }
  const now = Date.now();
  for (const [k, t] of localSeen) if (now - t > JTI_TTL_SECONDS * 1000) localSeen.delete(k);
  if (localSeen.has(jti)) return "replay";
  localSeen.set(jti, now);
  return "fresh";
}

/** Only the listed services may call this route (default: claw-auth). */
export function requireService(...allow: ServiceName[]) {
  const allowed: ServiceName[] = allow.length ? allow : ["xyne-claw-auth"];
  return async function requireServiceMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const path = (req.originalUrl || req.url || "").split("?")[0] ?? "";
    const result = verifyServiceAssertion(req.headers[SERVICE_ASSERTION_HEADER], { allow: allowed, method: req.method, path });
    if (typeof result === "string") {
      log.warn(`[service-assertion] rejected (${result}) ${req.method} ${path}`);
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const claim = await claimJti(result.jti);
    if (claim !== "fresh") {
      res.status(claim === "unavailable" ? 503 : 401).json({ success: false, error: claim === "unavailable" ? "Service authentication unavailable" : "Unauthorized" });
      return;
    }
    next();
  };
}
