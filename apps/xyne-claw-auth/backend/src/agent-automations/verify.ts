/**
 * Pluggable per-source signature verification — defense-in-depth ON TOP of the
 * URL secret, NOT a replacement for it. The substrate stays vendor-agnostic:
 * the ingress always checks the URL secret first; verification is an optional
 * second gate selected by `AgentAutomation.verifySource`.
 *
 * A verifier is a pure function of (rawBody, headers, signingSecret) → ok/deny.
 * Byte-exact HMAC is possible because main.ts captures `req.rawBody` before
 * `express.json()` parses it (see main.ts express.json `verify` hook) — an HMAC
 * recomputed over a re-serialised body would NOT match a real sender, so the
 * raw bytes are mandatory and are threaded through here.
 *
 * Registered verifiers:
 *   github-hmac-sha256  GitHub's `x-hub-signature-256: sha256=<hex>` over the body.
 *   hmac-sha256         Generic hex HMAC-SHA256, no prefix, in `signatureHeader`.
 *   header-token        Shared-secret token compared constant-time against a
 *                       header value (byte-order independent — safe when the
 *                       raw body is unavailable or the sender signs nothing).
 *
 * Add a new source by adding one entry to VERIFIERS. No route change needed.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export interface VerifierInput {
  /** Exact bytes the sender transmitted (from req.rawBody). May be undefined
   *  for an empty body — HMAC verifiers treat that as no-signature. */
  rawBody: Buffer | undefined;
  /** Lower-cased header map. */
  headers: Record<string, string>;
  /** Decrypted signing secret configured on the automation. */
  signingSecret: string;
  /** Header carrying the signature/token; verifier-specific default applies. */
  signatureHeader?: string | null;
}

type Verifier = (input: VerifierInput) => VerifyResult;

/** Length-safe constant-time string compare (never throws on length mismatch). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function header(headers: Record<string, string>, name: string): string | undefined {
  return headers[name.toLowerCase()];
}

/** HMAC-SHA256 verifier factory. `prefix` is stripped from the header value
 *  (GitHub sends `sha256=<hex>`); pass "" for a bare hex signature. */
function hmacSha256Verifier(defaultHeader: string, prefix: string): Verifier {
  return ({ rawBody, headers, signingSecret, signatureHeader }) => {
    if (!rawBody || rawBody.length === 0) return { ok: false, reason: "empty body" };
    const hdrName = signatureHeader || defaultHeader;
    const provided = header(headers, hdrName);
    if (!provided) return { ok: false, reason: `missing ${hdrName}` };
    const got = provided.startsWith(prefix) ? provided.slice(prefix.length) : provided;
    const expected = createHmac("sha256", signingSecret).update(rawBody).digest("hex");
    return safeEqual(got.toLowerCase(), expected)
      ? { ok: true }
      : { ok: false, reason: "signature mismatch" };
  };
}

/** Shared-token verifier: compare a header value to the secret, constant-time. */
const headerTokenVerifier: Verifier = ({ headers, signingSecret, signatureHeader }) => {
  const hdrName = signatureHeader || "x-webhook-token";
  const provided = header(headers, hdrName);
  if (!provided) return { ok: false, reason: `missing ${hdrName}` };
  return safeEqual(provided, signingSecret) ? { ok: true } : { ok: false, reason: "token mismatch" };
};

const VERIFIERS: Record<string, Verifier> = {
  "github-hmac-sha256": hmacSha256Verifier("x-hub-signature-256", "sha256="),
  "hmac-sha256": hmacSha256Verifier("x-signature", ""),
  "header-token": headerTokenVerifier,
};

/** True when `source` names a registered verifier (used at propose-time to
 *  reject an unknown verifier before it can silently no-op at ingress). */
export function isKnownVerifier(source: string): boolean {
  return Object.prototype.hasOwnProperty.call(VERIFIERS, source);
}

export function knownVerifierSources(): string[] {
  return Object.keys(VERIFIERS);
}

/**
 * Run the configured verifier. An UNKNOWN source fails closed (deny) rather
 * than silently accepting — a misconfigured automation must not become an open
 * endpoint. Callers only reach here after the URL-secret check has passed.
 */
export function verifySignature(source: string, input: VerifierInput): VerifyResult {
  const verifier = VERIFIERS[source];
  if (!verifier) return { ok: false, reason: `unknown verifier '${source}'` };
  return verifier(input);
}
