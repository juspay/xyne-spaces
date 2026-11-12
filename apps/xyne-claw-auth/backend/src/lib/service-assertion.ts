/**
 * Service-to-service authentication without a shared key.
 *
 * Each service (Spaces, claw-auth, the xyne-claw runtime) holds only its own
 * ES256 private key and signs a short assertion per request; receivers hold
 * the senders' public keys. A leaked key lets an attacker act only as that one
 * service, and user identity never comes from a header: it comes from a run
 * token (runtime calls) or a Spaces delegation token (Spaces calls).
 *
 * Header `x-service-assertion: <JWT>`, typ "xyne-service+jwt", ES256, kid.
 * Claims { iss <service>, aud <service>, htm method, htu path (no query),
 *          iat, exp (≤ 60 s), jti (single use) }.
 */

import { createPrivateKey, createPublicKey, randomUUID, sign, verify, type KeyObject } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { CONFIG } from "../config.js";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";

const log = createLogger("service-assertion");

export type ServiceName = "xyne-spaces" | "xyne-claw-auth" | "xyne-claw";
export const SELF: ServiceName = "xyne-claw-auth";
export const SERVICE_ASSERTION_HEADER = "x-service-assertion";
export const SERVICE_ASSERTION_TYP = "xyne-service+jwt";

const LIFETIME_SECONDS = 60;
const MAX_LIFETIME_SECONDS = 120;
const CLOCK_SKEW_SECONDS = 30;
const JTI_TTL_SECONDS = MAX_LIFETIME_SECONDS + CLOCK_SKEW_SECONDS;

const b64url = (b: Buffer | string) => (typeof b === "string" ? Buffer.from(b, "utf8") : b).toString("base64url");

function isP256(k: KeyObject): boolean {
  return k.asymmetricKeyType === "ec" && k.asymmetricKeyDetails?.namedCurve === "prime256v1";
}

// ── Signing (claw-auth as the caller) ────────────────────────────────────────

let signingCache: { pem: string; key: KeyObject | null } | null = null;

function signingKey(): KeyObject | null {
  const pem = CONFIG.clawServicePrivateKey ?? "";
  if (signingCache && signingCache.pem === pem) return signingCache.key;
  let key: KeyObject | null = null;
  if (pem) {
    try {
      const k = createPrivateKey(pem);
      if (isP256(k)) key = k;
      else log.error("[service-assertion] CLAW_SERVICE_PRIVATE_KEY must be an EC P-256 key");
    } catch (err) {
      log.error("[service-assertion] CLAW_SERVICE_PRIVATE_KEY could not be parsed:", err instanceof Error ? err.message : err);
    }
  }
  signingCache = { pem, key };
  return key;
}

export class ServiceAuthNotConfiguredError extends Error {
  readonly status = 503;
  constructor() {
    super("CLAW_SERVICE_PRIVATE_KEY not configured");
    this.name = "ServiceAuthNotConfiguredError";
  }
}

export function serviceSigningConfigured(): boolean {
  return signingKey() !== null;
}

/** One-shot assertion from claw-auth to `aud` for `method path` (query string ignored). */
export function signServiceAssertion(aud: ServiceName, method: string, path: string): string {
  const key = signingKey();
  if (!key) throw new ServiceAuthNotConfiguredError();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", typ: SERVICE_ASSERTION_TYP, kid: CONFIG.clawServiceKeyId };
  const payload = {
    iss: SELF,
    aud,
    iat: now,
    exp: now + LIFETIME_SECONDS,
    jti: randomUUID(),
    htm: method.toUpperCase(),
    htu: path.split("?")[0],
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  return `${input}.${b64url(sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }))}`;
}

/** Headers proving claw-auth is calling `url` (absolute URL or path) with `method`. */
export function serviceAuthHeaders(aud: ServiceName, method: string, url: string): Record<string, string> {
  const path = /^https?:\/\//i.test(url) ? new URL(url).pathname : url.split("?")[0] ?? url;
  return { [SERVICE_ASSERTION_HEADER]: signServiceAssertion(aud, method, path) };
}

// ── Verifying (claw-auth as the receiver) ────────────────────────────────────

const publicKeyCache = new Map<string, KeyObject | null>();

function toPublicKey(pem: string): KeyObject | null {
  if (publicKeyCache.has(pem)) return publicKeyCache.get(pem) ?? null;
  let key: KeyObject | null = null;
  try {
    const k = createPublicKey(pem);
    if (isP256(k)) key = k;
  } catch {
    key = null;
  }
  publicKeyCache.set(pem, key);
  return key;
}

/** Public keys allowed to sign as `iss`, by kid. Each issuer has its own set. */
function issuerKey(iss: ServiceName, kid: string): KeyObject | null {
  if (iss === "xyne-spaces") {
    const pem = CONFIG.spacesDelegationPublicKeys[kid];
    return pem ? toPublicKey(pem) : null;
  }
  if (iss === "xyne-claw") {
    const pem = CONFIG.clawRuntimePublicKeys[kid];
    return pem ? toPublicKey(pem) : null;
  }
  // claw-auth calling itself (callbacks it hands to the runtime come back elsewhere).
  const own = signingKey();
  return own && kid === CONFIG.clawServiceKeyId ? createPublicKey(own) : null;
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

export interface VerifiedService {
  iss: ServiceName;
  jti: string;
}

export type ServiceAssertionError =
  | "missing"
  | "malformed"
  | "wrong-type"
  | "issuer-not-allowed"
  | "unknown-key"
  | "bad-signature"
  | "wrong-audience"
  | "expired"
  | "lifetime-too-long"
  | "not-bound-to-request";

/** Verify signature, type, issuer, audience, lifetime and request binding. Replay is checked separately. */
export function verifyServiceAssertion(
  raw: unknown,
  opts: { allow: readonly ServiceName[]; method: string; path: string; now?: number },
): VerifiedService | ServiceAssertionError {
  if (typeof raw !== "string" || !raw.trim()) return "missing";
  const parts = raw.trim().split(".");
  if (parts.length !== 3) return "malformed";
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (!header || !payload || !parts[2]) return "malformed";
  if (header["alg"] !== "ES256" || header["typ"] !== SERVICE_ASSERTION_TYP) return "wrong-type";
  const iss = payload["iss"];
  if (typeof iss !== "string" || !(opts.allow as readonly string[]).includes(iss)) return "issuer-not-allowed";
  const kid = typeof header["kid"] === "string" ? header["kid"] : "";
  const key = kid ? issuerKey(iss as ServiceName, kid) : null;
  if (!key) return "unknown-key";
  const ok = verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2], "base64url"));
  if (!ok) return "bad-signature";
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

/** Accept each assertion once (shared across replicas). Fails closed when Redis is down. */
export async function claimAssertionJti(jti: string): Promise<"fresh" | "replay" | "unavailable"> {
  try {
    const set = await redisService.getConnection().set(`service-assertion:${jti}`, "1", "EX", JTI_TTL_SECONDS, "NX");
    return set === "OK" ? "fresh" : "replay";
  } catch (err) {
    log.error("[service-assertion] replay check unavailable (Redis):", err instanceof Error ? err.message : err);
    return "unavailable";
  }
}

function requestPath(req: Request): string {
  return (req.originalUrl || req.url || "").split("?")[0] ?? "";
}

/** The service that signed this request, when a route was reached through requireService. */
export function callerService(req: Request): ServiceName | undefined {
  return (req as Request & { callerService?: ServiceName }).callerService;
}

/**
 * Verify this request's assertion once and remember the result on the request,
 * so a route-level gate and requireAuth don't both claim the same jti.
 * "missing" when the request carries no assertion at all.
 */
export async function authenticateCaller(
  req: Request,
  allow: readonly ServiceName[],
): Promise<ServiceName | "missing" | "rejected" | "unavailable"> {
  const known = callerService(req);
  if (known) return allow.includes(known) ? known : "rejected";
  const raw = req.headers[SERVICE_ASSERTION_HEADER];
  if (raw === undefined || raw === "") return "missing";
  const result = verifyServiceAssertion(raw, { allow, method: req.method, path: requestPath(req) });
  if (typeof result === "string") {
    log.warn(`[service-assertion] rejected (${result}) ${req.method} ${requestPath(req)}`);
    return "rejected";
  }
  const claim = await claimAssertionJti(result.jti);
  if (claim === "unavailable") return "unavailable";
  if (claim === "replay") {
    log.warn(`[service-assertion] replayed (${result.iss}) ${req.method} ${requestPath(req)}`);
    return "rejected";
  }
  (req as Request & { callerService?: ServiceName }).callerService = result.iss;
  return result.iss;
}

/**
 * Only the listed services may call this route. Sets req.callerService.
 * 401 for a missing/invalid assertion, 503 when the replay check can't run.
 */
export function requireService(...allow: ServiceName[]) {
  return async function requireServiceMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const caller = await authenticateCaller(req, allow);
    if (caller === "unavailable") {
      res.status(503).json({ success: false, error: "Service authentication unavailable" });
      return;
    }
    if (caller === "missing" || caller === "rejected") {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    next();
  };
}

/** Routes the xyne-claw runtime calls (and claw-auth itself, for callbacks it hands out). */
export const requireRuntime = requireService("xyne-claw", "xyne-claw-auth");
/** Routes the Spaces backend calls. */
export const requireSpacesService = requireService("xyne-spaces");
/** Routes more than one service calls (e.g. /internal/run: Spaces, the runtime and claw-auth). */
export const requireAnyService = requireService("xyne-spaces", "xyne-claw", "xyne-claw-auth");
