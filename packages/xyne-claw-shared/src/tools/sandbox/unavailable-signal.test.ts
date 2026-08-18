/**
 * The sandbox_unavailable signal crosses three packages (shared tool →
 * xyne-claw runtime → claw-auth run-recovery) as a plain string. These tests
 * pin the contract so a reworded user-facing message can't silently break the
 * defer-and-auto-resume path.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  SANDBOX_UNAVAILABLE_SENTINEL,
  isSandboxUnavailableDeferEnabled,
  formatSandboxUnavailable,
  isSandboxUnavailable,
} from "./unavailable-signal.js";

describe("sandbox_unavailable wire contract", () => {
  it("uses the exact token claw-auth run-recovery matches on", () => {
    // run-recovery-worker.ts isSandboxUnavailableFailure() and run.ts's failure
    // callback both hard-code this literal; changing it breaks the defer path.
    expect(SANDBOX_UNAVAILABLE_SENTINEL).toBe("sandbox_unavailable");
  });

  it("round-trips: what the tool emits is what the runtime detects", () => {
    const emitted = formatSandboxUnavailable("claim never reached Running");
    expect(isSandboxUnavailable(emitted)).toBe(true);
    // Carries the detail through for the logs/UI without affecting matching.
    expect(emitted).toContain("claim never reached Running");
  });

  it("keeps the Error: prefix so non-participating callers see a normal error", () => {
    expect(formatSandboxUnavailable("x")).toMatch(/^Error: /);
  });

  it("does not match unrelated sandbox failures", () => {
    // These must keep flowing through the read-only fallback / normal error
    // handling — a false positive would park a run that could have proceeded.
    expect(isSandboxUnavailable("Error: repository not found")).toBe(false);
    expect(isSandboxUnavailable("Error: branch 'nope' does not exist")).toBe(false);
    expect(isSandboxUnavailable("sandbox session created")).toBe(false);
  });

  it("matches regardless of surrounding wording (message can be reworded freely)", () => {
    expect(isSandboxUnavailable(`Error: ${SANDBOX_UNAVAILABLE_SENTINEL}: totally different copy`)).toBe(true);
  });
});

describe("defer flag default", () => {
  const KEY = "SANDBOX_UNAVAILABLE_DEFER";
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it("is ON when unset — the defer path is the default behaviour", () => {
    delete process.env[KEY];
    expect(isSandboxUnavailableDeferEnabled()).toBe(true);
  });

  it("is OFF only for the exact opt-out value \"false\"", () => {
    process.env[KEY] = "false";
    expect(isSandboxUnavailableDeferEnabled()).toBe(false);
  });

  it("stays ON for other truthy-ish values (no accidental disable)", () => {
    for (const v of ["true", "1", "TRUE", "no", ""]) {
      process.env[KEY] = v;
      expect(isSandboxUnavailableDeferEnabled()).toBe(true);
    }
  });
});
