/**
 * subagent-followup.test.ts
 *
 * Covers the two safety-critical primitives behind parent→subagent follow-ups
 * (handle validation + the per-handle resume lock), plus a config invariant
 * asserting `supportsFollowUp` is only enabled on read/research subagents and
 * never on stateful/action ones.
 */
import { describe, it, expect } from "vitest";
import { SUBAGENT_DEFINITIONS } from "xyne-claw-shared";
import {
  isValidFollowUpHandle,
  acquireFollowUpLock,
  SAFE_FOLLOWUP_HANDLE_RE,
} from "../src/subagent-followup.js";

describe("isValidFollowUpHandle", () => {
  it("accepts a crypto.randomUUID() handle", () => {
    // Real shape the code mints.
    const uuid = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
    expect(isValidFollowUpHandle(uuid)).toBe(true);
    expect(SAFE_FOLLOWUP_HANDLE_RE.test(uuid)).toBe(true);
  });

  it("accepts plain alphanumerics with _ and -", () => {
    expect(isValidFollowUpHandle("abc_DEF-123")).toBe(true);
  });

  it.each([
    ["empty string", ""],
    ["path traversal", "../etc/passwd"],
    ["parent ref", ".."],
    ["single dot", "."],
    ["contains slash", "a/b"],
    ["contains backslash", "a\\b"],
    ["contains dot", "a.b"],
    ["whitespace", "a b"],
    ["null byte", "a\u0000b"],
    ["newline", "a\nb"],
  ])("rejects %s", (_label, value) => {
    expect(isValidFollowUpHandle(value)).toBe(false);
  });

  it("rejects an over-length handle (>128 chars)", () => {
    expect(isValidFollowUpHandle("a".repeat(129))).toBe(false);
    expect(isValidFollowUpHandle("a".repeat(128))).toBe(true);
  });

  it("rejects non-string inputs", () => {
    expect(isValidFollowUpHandle(undefined)).toBe(false);
    expect(isValidFollowUpHandle(null)).toBe(false);
    expect(isValidFollowUpHandle(123)).toBe(false);
    expect(isValidFollowUpHandle({})).toBe(false);
  });
});

describe("acquireFollowUpLock", () => {
  it("serializes concurrent acquisitions of the SAME key (no overlap)", async () => {
    const key = "/sessions/conv1/subagents/spaces/handle-A";
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;

    async function critical(id: string) {
      const release = await acquireFollowUpLock(key);
      try {
        active += 1;
        maxActive = Math.max(maxActive, active);
        events.push(`enter:${id}`);
        await new Promise((r) => setTimeout(r, 15));
        events.push(`exit:${id}`);
        active -= 1;
      } finally {
        release();
      }
    }

    await Promise.all([critical("1"), critical("2"), critical("3")]);

    // Never two holders at once.
    expect(maxActive).toBe(1);
    // Strict enter/exit interleaving proves mutual exclusion.
    expect(events).toEqual([
      "enter:1", "exit:1",
      "enter:2", "exit:2",
      "enter:3", "exit:3",
    ]);
  });

  it("allows different keys to run concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    async function critical(key: string) {
      const release = await acquireFollowUpLock(key);
      try {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 15));
        active -= 1;
      } finally {
        release();
      }
    }
    await Promise.all([
      critical("/sessions/conv1/subagents/spaces/handle-X"),
      critical("/sessions/conv1/subagents/github/handle-Y"),
    ]);
    // Distinct keys are independent → they overlap.
    expect(maxActive).toBe(2);
  });

  it("is idempotent on double-release and lets a later waiter proceed", async () => {
    const key = "/sessions/conv2/subagents/grafana/handle-Z";
    const release1 = await acquireFollowUpLock(key);
    release1();
    release1(); // second call is a no-op, must not throw or corrupt the chain

    // A fresh acquisition on the same key still works.
    const release2 = await acquireFollowUpLock(key);
    expect(typeof release2).toBe("function");
    release2();
  });
});

describe("SUBAGENT_DEFINITIONS supportsFollowUp invariant", () => {
  // Read/research subagents where a scoped drill-down on the same evidence is
  // the natural next step — these are the ones we intentionally opted in.
  const EXPECTED_FOLLOWUP = new Set([
    "spaces",
    "bitbucket",
    "github",
    "grafana",
    "deepwiki",
    "context7",
  ]);

  // Stateful / action / delegation subagents where resuming an old child
  // session must NOT be silently offered. Guards against accidental enablement.
  const MUST_NOT_FOLLOWUP = ["juspay-dashboard", "artifacts", "slack", "asana"];

  it("enables supportsFollowUp on exactly the intended research subagents", () => {
    const enabled = SUBAGENT_DEFINITIONS.filter((d) => d.supportsFollowUp).map((d) => d.name).sort();
    expect(enabled).toEqual([...EXPECTED_FOLLOWUP].sort());
  });

  it("does not enable follow-up on stateful/action subagents", () => {
    for (const name of MUST_NOT_FOLLOWUP) {
      const def = SUBAGENT_DEFINITIONS.find((d) => d.name === name);
      if (!def) continue; // tolerate catalog drift; only assert when present
      expect(def.supportsFollowUp ?? false).toBe(false);
    }
  });
});
