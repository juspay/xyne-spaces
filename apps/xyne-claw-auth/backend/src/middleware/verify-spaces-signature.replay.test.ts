import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "./verify-spaces-signature.ts"), "utf8");

// Pins the L-12 hardening follow-up: the replay set is authoritative in Redis
// (shared across replicas, survives restarts) with the in-memory map demoted
// to a Redis-down fallback. A refactor that quietly drops back to per-pod
// memory reopens the cross-replica replay window.

describe("webhook signature replay guard", () => {
  it("records signatures in Redis atomically with a TTL", () => {
    // SET NX EX in one call — check-then-set as two round trips would race
    // between replicas receiving the same replay simultaneously.
    expect(src).toMatch(/redis\.set\(key, "1", "EX", SEEN_SIGNATURE_TTL_SEC, "NX"\)/);
  });

  it("stores a hash of the signature, never the raw HMAC", () => {
    expect(src).toContain('createHash("sha256").update(signature)');
    expect(src).toContain("spaces-sig-replay:");
  });

  it("rejects on a Redis replay verdict before falling back", () => {
    const guard = src.slice(src.indexOf("const redisVerdict"), src.indexOf("next();"));
    expect(guard).toContain('redisVerdict === "replay"');
    expect(guard).toContain('verificationFailure("replayed_signature"');
    // The in-memory path runs ONLY when Redis was unavailable (verdict null).
    expect(guard).toContain("redisVerdict === null");
  });

  it("exempts flow_action callbacks from replay dedup (owner-directed unblock)", () => {
    // Flow-action signatures are intentionally stable and are protected against
    // double-execution downstream (per-action HMAC + atomic card consume), so a
    // re-clicked/retried approval must not be replay-rejected as a duplicate.
    const guard = src.slice(src.indexOf("const isFlowAction"), src.indexOf("next();"));
    expect(guard).toContain('req.headers["x-xyne-event"] === "flow_action"');
    expect(guard).toContain("if (!isInternalReverify && !isFlowAction)");
  });

  it("skips the replay dedup for internal s2s re-verification (the proxy hop)", () => {
    // A single approval is signature-verified twice in one chain: /webhook edge
    // (external, no s2s key) then /flow/action (proxied WITH the s2s key). The
    // replay set must record only the edge check, or the proxied re-verify of
    // the SAME signature is rejected as "duplicate signature" and every Spaces
    // flow-action approval 401s. Gate: replay runs only when NOT an s2s caller.
    const guard = src.slice(src.indexOf("const isInternalReverify"), src.indexOf("next();"));
    expect(guard).toContain("s2sKeyMatches(req.headers[\"x-s2s-key\"])");
    expect(guard).toContain("!isInternalReverify");
    // The HMAC authenticity check must NOT be inside the skip — only the replay
    // record/check is gated. (The match comparison lives above this slice.)
    expect(guard).toContain("checkSignatureReplayRedis");
  });

  it("keeps the TTL aligned with the timestamp skew window", () => {
    // The replay set only needs to cover the window in which a stale timestamp
    // would still pass; a shorter TTL reopens replays early, a longer one just
    // wastes memory. Deriving one from the other keeps them locked together.
    expect(src).toContain("const SEEN_SIGNATURE_TTL_MS = MAX_TIMESTAMP_SKEW_MS");
    expect(src).toContain("Math.ceil(SEEN_SIGNATURE_TTL_MS / 1000)");
  });
});
