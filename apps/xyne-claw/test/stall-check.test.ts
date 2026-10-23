import { describe, expect, it } from "vitest";
import { detectStall, firstTokenLimitMs } from "../src/stall-check.js";

const base = { now: 100_000, lastActivityAt: 100_000, awaitingFirstTokenSince: null, idleLimitMs: 120_000, firstTokenLimitMs: 45_000 };

describe("detectStall", () => {
  it("flags a model that has sent no first token past the first-token limit", () => {
    expect(detectStall({ ...base, now: 150_000, lastActivityAt: 149_000, awaitingFirstTokenSince: 100_000 })).toEqual({ kind: "first-token", waitedMs: 50_000 });
  });

  it("leaves a slow but under-limit first token alone", () => {
    expect(detectStall({ ...base, now: 140_000, awaitingFirstTokenSince: 100_000 })).toBeNull();
  });

  it("stops watching the first token once streaming has started", () => {
    expect(detectStall({ ...base, now: 200_000, lastActivityAt: 199_000, awaitingFirstTokenSince: null })).toBeNull();
  });

  it("keeps the idle rule for streams that went quiet", () => {
    expect(detectStall({ ...base, now: 230_000, lastActivityAt: 100_000 })).toEqual({ kind: "idle", waitedMs: 130_000 });
  });

  it("can disable either rule with a zero limit", () => {
    expect(detectStall({ ...base, now: 300_000, lastActivityAt: 0, awaitingFirstTokenSince: 0, idleLimitMs: 0, firstTokenLimitMs: 0 })).toBeNull();
  });
});

describe("firstTokenLimitMs", () => {
  it("applies 45s to Claude only, overridable by env", () => {
    expect(firstTokenLimitMs("claude", {})).toBe(45_000);
    expect(firstTokenLimitMs("claude", { AGENT_FIRST_TOKEN_STALL_MS: "30000" })).toBe(30_000);
    expect(firstTokenLimitMs("litellm", {})).toBe(0);
    expect(firstTokenLimitMs(undefined, {})).toBe(0);
  });
});
