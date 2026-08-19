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

  it("keeps the TTL aligned with the timestamp skew window", () => {
    // The replay set only needs to cover the window in which a stale timestamp
    // would still pass; a shorter TTL reopens replays early, a longer one just
    // wastes memory. Deriving one from the other keeps them locked together.
    expect(src).toContain("const SEEN_SIGNATURE_TTL_MS = MAX_TIMESTAMP_SKEW_MS");
    expect(src).toContain("Math.ceil(SEEN_SIGNATURE_TTL_MS / 1000)");
  });
});
