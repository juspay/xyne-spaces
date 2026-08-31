/**
 * Verify the `X-Xyne-Signature` HMAC-SHA256 Spaces puts on every outbound
 * webhook call.
 *
 * Flow:
 *   1. Look up the agent by `req.params.spacesAppId` on /webhook/app/:spacesAppId,
 *      otherwise by `req.params.agentSlug`.
 *   2. Decrypt `agents.signingSecret` (GCM 3-tuple).
 *   3. Compute HMAC-SHA256 over the RAW request body.
 *   4. Timing-safe compare against `X-Xyne-Signature` header (hex).
 *
 * Every verification failure rejects with 401. The webhook handler trusts
 * payload identity and can run agents with that user's credentials, so an
 * unsigned or invalid callback must never reach a downstream handler.
 *
 * Notes / gotchas:
 *   - Requires `req.rawBody` set by the json `verify` callback in main.ts.
 *     If the body wasn't JSON or was empty we treat raw as `Buffer.alloc(0)`.
 *   - Reused for /webhook/:agentSlug only. The generic /webhook (no slug)
 *     route has no agent-attribution and is left alone — that path is
 *     legacy and not used in current Spaces flows.
 *   - Does NOT change req body shape. Downstream handlers continue to read
 *     req.body (JSON-parsed) as before.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { errMsg } from "../lib/errors.js";
import type { NextFunction, Request, Response } from "express";
import { CONFIG } from "../config.js";
import { decrypt } from "../crypto.js";
import { prisma } from "../db.js";
import { redisService } from "../redis.js";
import { s2sKeyMatches } from "./require-auth.js";

import { createLogger } from "../logger.js";
const log = createLogger("verify-spaces-signature");

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;
const SEEN_SIGNATURE_TTL_MS = MAX_TIMESTAMP_SKEW_MS;
const SEEN_SIGNATURE_TTL_SEC = Math.ceil(SEEN_SIGNATURE_TTL_MS / 1000);
const MAX_SEEN_SIGNATURES = 10_000;
// Fallback only — the authoritative replay set lives in Redis so all replicas
// share it and a pod restart doesn't reopen the window. This map covers the
// Redis-down case at the old per-pod strength.
const seenSignatures = new Map<string, number>();

/**
 * Atomically record-and-check the signature in Redis. Returns:
 *   "fresh"  — first sighting, recorded (SET NX won the race)
 *   "replay" — already recorded inside the TTL window
 *   null     — Redis unavailable; caller falls back to the in-memory map
 * The key hashes the signature: bounded key size, and the raw HMAC never
 * appears in Redis (a dump of the keyspace shouldn't yield replayable values).
 */
async function checkSignatureReplayRedis(signature: string): Promise<"fresh" | "replay" | null> {
  try {
    const redis = redisService.getConnection();
    const key = `spaces-sig-replay:${createHash("sha256").update(signature).digest("hex")}`;
    const set = await redis.set(key, "1", "EX", SEEN_SIGNATURE_TTL_SEC, "NX");
    return set === "OK" ? "fresh" : "replay";
  } catch (err) {
    log.warn(`[replay-check] redis unavailable, falling back to in-memory set: ${errMsg(err)}`);
    return null;
  }
}

function pruneSeenSignatures(now: number): void {
  if (seenSignatures.size < MAX_SEEN_SIGNATURES) return;
  for (const [sig, expiry] of seenSignatures) {
    if (expiry <= now) seenSignatures.delete(sig);
  }
  if (seenSignatures.size >= MAX_SEEN_SIGNATURES) {
    const overflow = seenSignatures.size - MAX_SEEN_SIGNATURES + 1;
    let i = 0;
    for (const sig of seenSignatures.keys()) {
      seenSignatures.delete(sig);
      if (++i >= overflow) break;
    }
  }
}

function parseSignedEpochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === "string" && value.length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 1e12 ? numeric : numeric * 1000;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function signedTimestampMs(rawBody: Buffer): number | null {
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody.toString("utf8")); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as { timestamp?: unknown; payload?: { createdAt?: unknown } };
  return parseSignedEpochMs(obj.timestamp) ?? parseSignedEpochMs(obj.payload?.createdAt);
}

function parseGcmBundle(blob: string): [string, string, string] | null {
  const parts = blob.split(":");
  if (parts.length !== 3) return null;
  const [ciphertext, iv, authTag] = parts;
  if (!ciphertext || !iv || !authTag) return null;
  return [ciphertext, iv, authTag];
}

function tag(key: string, reason: string): string {
  return `[verify-spaces-sig] ${key} reason=${reason}`;
}

/**
 * TEMPORARY diagnostic for the `reason=mismatch` investigation. When the raw
 * body fails verification but the secret is known-correct, the body was mutated
 * in transit (proxy/ingress re-serialization, whitespace, BOM, line-endings).
 * This tests candidate canonicalizations and reports which (if any) reconciles
 * the body with the signature — WITHOUT logging the secret or any body content.
 * Remove once the canonicalization is identified and fixed at the source.
 */
function diagnoseMismatch(rawBody: Buffer, secret: string, received: string): string {
  const hmac = (s: string | Buffer): string => createHmac("sha256", secret).update(s).digest("hex");
  const text = rawBody.toString("utf8");
  const candidates: Array<[string, string | Buffer]> = [["raw", rawBody]];
  try { candidates.push(["trimEnd", text.replace(/\s+$/, "")]); } catch { /* noop */ }
  try { candidates.push(["trimStart", text.replace(/^\s+/, "")]); } catch { /* noop */ }
  try { if (text.charCodeAt(0) === 0xfeff) candidates.push(["stripBOM", text.slice(1)]); } catch { /* noop */ }
  try { candidates.push(["lf2crlf", text.replace(/\n/g, "\r\n")]); } catch { /* noop */ }
  try { candidates.push(["crlf2lf", text.replace(/\r\n/g, "\n")]); } catch { /* noop */ }
  let parses = false;
  try { candidates.push(["reserialize", JSON.stringify(JSON.parse(text))]); parses = true; } catch { /* not json */ }
  let hit = "none";
  for (const [name, value] of candidates) {
    try { if (hmac(value) === received) { hit = name; break; } } catch { /* noop */ }
  }
  const bodySha = createHmac("sha256", "diag").update(rawBody).digest("hex").slice(0, 12);
  return `match=${hit} parses=${parses} bodyBytes=${rawBody.length} bodySha=${bodySha}`;
}

export async function verifySpacesSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const params = req.params as { agentSlug?: string; spacesAppId?: string };
  const spacesAppId = params.spacesAppId;
  const slug = params.agentSlug;
  const lookupTag = spacesAppId ? `spacesAppId=${spacesAppId}` : `slug=${slug ?? "(none)"}`;

  const verificationFailure = (reason: string, error: string, detail?: string): void => {
    // One stable, grep-friendly log for every failed verification. Never
    // include the signature, secret, or request body.
    log.warn(
      tag(lookupTag, reason)
      + ` agentId=${agent?.id ?? "(not-found)"}`
      + (detail ? ` ${detail}` : "")
      + " — rejected",
    );
    res.status(401).json({ success: false, error });
  };

  // 1. Resolve the agent + its stored secret.
  let agent: { id: string; signingSecret: string | null } | null = null;
  if (spacesAppId) {
    agent = await prisma.agent.findFirst({ where: { spacesAppId }, select: { id: true, signingSecret: true } });
  } else if (slug) {
    const matches = await prisma.agent.findMany({
      where: { slug },
      select: { id: true, signingSecret: true, orgId: true },
      take: 2,
    });
    if (matches.length > 1) {
      log.error(tag(lookupTag, "ambiguous_legacy_slug") + ` — matched multiple orgs; rejecting legacy route`);
      res.status(404).json({ success: false, error: "agent not found" });
      return;
    }
    agent = matches[0] ?? null;
  }

  if (!agent?.signingSecret) {
    verificationFailure("no_stored_secret", "missing signing secret");
    return;
  }

  // 2. Decrypt with claw-auth's GCM scheme.
  const parts = parseGcmBundle(agent.signingSecret);
  if (!parts) {
    verificationFailure("malformed_secret_blob", "malformed signing secret");
    return;
  }
  let plaintextSecret: string;
  try {
    plaintextSecret = decrypt(parts[0], parts[1], parts[2], CONFIG.encryptionKey);
  } catch (err) {
    verificationFailure("decrypt_failed", "secret decrypt failed", `error=${errMsg(err)}`);
    return;
  }

  // 3. Compute HMAC over the raw body.
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
  const expected = createHmac("sha256", plaintextSecret).update(rawBody).digest("hex");

  // 4. Compare with the header.
  const received = req.headers["x-xyne-signature"];
  if (typeof received !== "string" || received.length === 0) {
    verificationFailure("no_signature_header", "missing X-Xyne-Signature");
    return;
  }

  const recBuf = Buffer.from(received, "hex");
  const expBuf = Buffer.from(expected, "hex");
  const matches = recBuf.length === expBuf.length && timingSafeEqual(recBuf, expBuf);

  if (!matches) {
    verificationFailure("mismatch", "invalid signature", `bodyBytes=${rawBody.length} headerLen=${received.length} ${diagnoseMismatch(rawBody, plaintextSecret, received)}`);
    return;
  }

  const now = Date.now();
  const signedTs = signedTimestampMs(rawBody);
  if (signedTs !== null && Math.abs(now - signedTs) > MAX_TIMESTAMP_SKEW_MS) {
    verificationFailure("stale_timestamp", "signature timestamp outside allowed window", `skewMs=${now - signedTs}`);
    return;
  }
  // Replay dedup runs ONLY for external Spaces callers (no s2s key). A single
  // approval click is signature-verified TWICE in one request chain: first at
  // the /webhook edge, then again at /flow/action after proxyFlowAction
  // forwards the SAME x-xyne-signature. That internal hop always carries the
  // s2s key (the /flow mount is requireStrictS2S), so gating on its ABSENCE
  // means the same in-flight signature is only recorded once. Without this the
  // replay guard rejects the second (proxied) verification as a "duplicate
  // signature" and every Spaces flow-action approval 401s. The HMAC
  // authenticity check above still runs on BOTH hops; only the replay-set
  // record/check is skipped for trusted s2s callers.
  // Flow-action callbacks (X-Xyne-Event: flow_action) are exempt from
  // signature-replay dedup: their signed body is intentionally STABLE (the same
  // approval re-clicks/retries hash identically), and double-execution is
  // already prevented downstream — flow-action.ts re-verifies a per-action HMAC
  // signature and the plan/skill/agent-tools apply paths consume the card
  // atomically ("already used"). Replay-rejecting them here is redundant AND is
  // exactly what hard-blocks approvals ("duplicate signature"). Detected at the
  // edge by the header; the internal /flow/action proxy hop carries the s2s key
  // (its mount is requireStrictS2S) and is covered by isInternalReverify.
  const isFlowAction = req.headers["x-xyne-event"] === "flow_action";
  const isInternalReverify = s2sKeyMatches(req.headers["x-s2s-key"]);
  if (!isInternalReverify && !isFlowAction) {
    const redisVerdict = await checkSignatureReplayRedis(received);
    if (redisVerdict === "replay") {
      verificationFailure("replayed_signature", "duplicate signature");
      return;
    }
    if (redisVerdict === null) {
      const priorExpiry = seenSignatures.get(received);
      if (priorExpiry !== undefined && priorExpiry > now) {
        verificationFailure("replayed_signature", "duplicate signature");
        return;
      }
      pruneSeenSignatures(now);
      seenSignatures.set(received, now + SEEN_SIGNATURE_TTL_MS);
    }
  }

  next();
}
