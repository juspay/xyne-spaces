import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response } from "express";
import { createHash } from "node:crypto";
import { SERVICE_ASSERTION_HEADER, verifyServiceAssertion, type ServiceName } from "../lib/service-assertion.js";
import { createLogger } from "../logger.js";

const log = createLogger("rate-limiters");

/**
 * A stable per-caller identifier taken from the session cookie.
 *
 * The limiter is mounted at the API root, which is BEFORE any auth middleware
 * runs, so `x-user-id` is not set yet: http/routes.ts strips the inbound header
 * for every caller and only the auth middleware puts it back. Reading it there
 * always found nothing and fell through to the IP, and behind a load balancer
 * that is one bucket for every signed-in person in the company.
 *
 * The cookie is the one caller identity available synchronously at that point,
 * with no /me round trip. It is not proof of identity, and it does not need to
 * be: this only decides which counter to increment, and every route still
 * authenticates for real downstream. Hashed so a live session id never becomes
 * a store key or turns up in a log line.
 */
function sessionKey(req: Request): string | null {
  const raw = req.headers?.cookie;
  if (!raw) return null;
  for (const name of ["user_session_id", "xyne_last_workspace"]) {
    const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(raw);
    const value = match?.[1]?.trim();
    if (value) return createHash("sha256").update(`${name}:${value}`).digest("hex").slice(0, 24);
  }
  return null;
}

function clientIpKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? "unknown");
}

function verifiedUserKey(req: Request): string | null {
  const header = req.headers?.["x-user-id"];
  const userId = Array.isArray(header) ? header[0] : header;
  if (userId && userId.trim()) return `user:${userId.trim()}`;
  const sessionUserId = (req as Request & { session?: { userId?: string } }).session?.userId;
  if (sessionUserId && sessionUserId.trim()) return `user:${sessionUserId.trim()}`;
  return null;
}

function identityOrIpKey(req: Request): string {
  return verifiedUserKey(req) ?? clientIpKey(req);
}

function requesterKey(req: Request): string {
  const verified = verifiedUserKey(req);
  if (verified) return verified;
  const cookie = sessionKey(req);
  if (cookie) return `sess:${cookie}`;
  return clientIpKey(req);
}

/**
 * True when the request carries a valid service assertion from one of `allow`
 * (signature, audience, lifetime, method + path). The limiter runs before auth
 * and must stay synchronous, so the single-use jti is NOT claimed here — the
 * route's own requireService / requireAuth does that and rejects a replay. A
 * replayed assertion can at most skip this counter, never reach a handler.
 */
function hasValidServiceAssertion(req: Request, allow: readonly ServiceName[]): boolean {
  const raw = req.headers?.[SERVICE_ASSERTION_HEADER];
  if (!raw) return false;
  const path = (req.originalUrl || req.url || "").split("?")[0] ?? "";
  return typeof verifyServiceAssertion(raw, { allow, method: req.method, path }) !== "string";
}

/** The runtime and claw-auth itself are never limited; Spaces only on SPACES_UNLIMITED_PREFIXES. */
function isInternalCaller(req: Request, _res: Response): boolean {
  return hasValidServiceAssertion(req, ["xyne-claw", "xyne-claw-auth"]);
}

/**
 * Spaces-backend routes (Spaces service assertion) that skip apiLimiter. Those calls
 * carry no user or cookie, so the requester key falls back to the address and
 * every Spaces call shares one bucket. The agent check runs inside installApp,
 * which stamps AGENT/APP once, so a 429 there fails the install.
 */
const SPACES_UNLIMITED_PREFIXES = ["/internal/agents"] as const;

/** `req.path` must be relative to the API base, as it is where apiLimiter is mounted. */
export function isUnlimitedSpacesCall(req: Request): boolean {
  return (
    SPACES_UNLIMITED_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`)) &&
    hasValidServiceAssertion(req, ["xyne-spaces"])
  );
}

export function createRequesterLimiter(options: {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    keyGenerator: options.keyGenerator ?? requesterKey,
    skip: isInternalCaller,
    message: {
      success: false,
      error: "Too many requests. Please slow down and try again shortly.",
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export const apiLimiter: RateLimitRequestHandler = createRequesterLimiter({ windowMs: 60 * 1000, max: 600 });


export const publicShareLimiter: RateLimitRequestHandler = createRequesterLimiter({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: identityOrIpKey,
});

const CLIENT_IP_SAMPLE_LIMIT = 20;
const sampledClientIps = new Set<string>();

export function sampleClientIp(req: Request): void {
  if (sampledClientIps.size >= CLIENT_IP_SAMPLE_LIMIT) return;
  const ip = req.ip ?? "unknown";
  if (sampledClientIps.has(ip)) return;
  sampledClientIps.add(ip);
  const forwarded = req.headers?.["x-forwarded-for"];
  const entries = typeof forwarded === "string" ? forwarded.split(",").length : Array.isArray(forwarded) ? forwarded.length : 0;
  log.info(`[rate-limit] client-ip sample ip=${ip} xff_entries=${entries} trust_proxy=${String(req.app?.get("trust proxy"))}`);
}

export const oauthLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: identityOrIpKey,
  message: {
    success: false,
    error: "Too many sign-in attempts. Please wait a moment and try again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
