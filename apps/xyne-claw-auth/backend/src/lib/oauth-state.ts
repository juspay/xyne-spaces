/**
 * Helpers for HMAC-signed OAuth `state` parameters.
 *
 * Why: legacy OAuth flows (Google/Microsoft/DocuSign) used `state = userId` raw,
 * which lets an attacker who can trigger an OAuth callback inject tokens for
 * an arbitrary `userId`. Wrapping userId in an HMAC-signed envelope with a
 * random nonce + timestamp closes that hole without server-side session state.
 *
 * Wire format (URL-safe):  base64url(JSON({ userId, nonce, ts })) + "." + hex(hmac)
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CONFIG } from "../config.js";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — generous for OAuth round-trip

interface StateInner {
  userId: string;
  nonce: string;
  ts: number;
  /** Free-form payload for providers that need extra round-trip data (PKCE, redirectUri, ...). */
  extra?: Record<string, unknown>;
}

function hmac(payload: string): string {
  return createHmac("sha256", CONFIG.oauthStateSigningKey).update(payload).digest("hex");
}

function hmacLegacy(payload: string): string {
  return createHmac("sha256", CONFIG.legacyOauthStateSigningKey).update(payload).digest("hex");
}

export function signOAuthState(userId: string, extra?: Record<string, unknown>): string {
  const inner: StateInner = {
    userId,
    nonce: randomBytes(16).toString("base64url"),
    ts: Date.now(),
    ...(extra ? { extra } : {}),
  };
  const body = Buffer.from(JSON.stringify(inner)).toString("base64url");
  return `${body}.${hmac(body)}`;
}

export interface VerifiedState {
  userId: string;
  extra?: Record<string, unknown>;
}

export class OAuthStateError extends Error {
  constructor(public readonly reason: "malformed" | "bad_signature" | "expired") {
    super(`OAuth state: ${reason}`);
  }
}

export function verifyOAuthState(state: string): VerifiedState {
  const dot = state.lastIndexOf(".");
  if (dot <= 0 || dot === state.length - 1) {
    throw new OAuthStateError("malformed");
  }
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = hmac(body);
  const legacyExpected = hmacLegacy(body);
  let sigBuf: Buffer;
  let expectedBuf: Buffer;
  let legacyExpectedBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, "hex");
    expectedBuf = Buffer.from(expected, "hex");
    legacyExpectedBuf = Buffer.from(legacyExpected, "hex");
  } catch {
    throw new OAuthStateError("bad_signature");
  }
  const matchesCurrent = sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  const matchesLegacy = sigBuf.length === legacyExpectedBuf.length && timingSafeEqual(sigBuf, legacyExpectedBuf);
  if (!matchesCurrent && !matchesLegacy) {
    throw new OAuthStateError("bad_signature");
  }

  let inner: StateInner;
  try {
    inner = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StateInner;
  } catch {
    throw new OAuthStateError("malformed");
  }

  if (typeof inner.userId !== "string" || typeof inner.ts !== "number") {
    throw new OAuthStateError("malformed");
  }
  if (Date.now() - inner.ts > STATE_TTL_MS) {
    throw new OAuthStateError("expired");
  }

  return inner.extra !== undefined
    ? { userId: inner.userId, extra: inner.extra }
    : { userId: inner.userId };
}
