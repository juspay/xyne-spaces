import { createHmac, timingSafeEqual } from "node:crypto";
import { CONFIG } from "../config.js";

const TOKEN_VERSION = 1;
const KEY_LABEL = "xyne-claw-auth/session-token/v1";

const SIGNING_KEY: Buffer = createHmac("sha256", CONFIG.encryptionKey).update(KEY_LABEL).digest();

export interface SessionTokenPayload {
  v: number;
  sid: string;
  uid: string;
  aslug?: string;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payloadB64: string): string {
  const sig = createHmac("sha256", SIGNING_KEY).update(payloadB64).digest();
  return b64url(sig);
}

export function mintSessionToken(
  args: { sessionId: string; userId: string; agentSlug?: string; ttlSeconds: number },
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionTokenPayload = {
    v: TOKEN_VERSION,
    sid: args.sessionId,
    uid: args.userId,
    ...(args.agentSlug ? { aslug: args.agentSlug } : {}),
    iat: now,
    exp: now + Math.max(60, Math.floor(args.ttlSeconds)),
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

export type VerifyError = "malformed" | "bad-signature" | "bad-version" | "expired" | "bad-payload";

/**
 * Check a result-callback's `x-session-token` against the sessionId the callback
 * claims to be for. The pod attaches the run's sessionToken on every result
 * callback; the token's `sid` MUST equal the run's sessionId. This is what makes
 * a result spoof-resistant per-run rather than relying on the shared S2S key
 * alone. The /result endpoints reject (401) when this fails.
 */
export function checkResultCallbackToken(
  rawToken: string | undefined,
  expectedSessionId: string,
): { ok: true } | { ok: false; reason: string } {
  const r = verifySessionToken(rawToken);
  if (typeof r === "string") return { ok: false, reason: r };
  if (!expectedSessionId || r.sid !== expectedSessionId) return { ok: false, reason: "sid-mismatch" };
  return { ok: true };
}

export function verifySessionToken(raw: string | undefined): SessionTokenPayload | VerifyError {
  if (!raw || typeof raw !== "string") return "malformed";
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return "malformed";
  const payloadB64 = raw.slice(0, dot);
  const sigB64 = raw.slice(dot + 1);

  const expected = sign(payloadB64);
  const expectedBuf = fromB64url(expected);
  const givenBuf = fromB64url(sigB64);
  if (expectedBuf.length !== givenBuf.length) return "bad-signature";
  if (!timingSafeEqual(expectedBuf, givenBuf)) return "bad-signature";

  let payload: SessionTokenPayload;
  try {
    payload = JSON.parse(fromB64url(payloadB64).toString("utf8")) as SessionTokenPayload;
  } catch {
    return "bad-payload";
  }
  if (payload.v !== TOKEN_VERSION) return "bad-version";
  if (typeof payload.sid !== "string" || !payload.sid) return "bad-payload";
  if (typeof payload.uid !== "string" || !payload.uid) return "bad-payload";
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return "expired";

  return payload;
}
