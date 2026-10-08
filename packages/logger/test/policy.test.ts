import { afterEach, describe, expect, it, vi } from "vitest";
import { shred, shredRecordInPlace } from "../src/shredder.js";
import {
  getRedactAllowList,
  parseRedactAllowList,
  setRedactAllowList,
  syncRedactAllowList,
} from "../src/policy.js";

afterEach(() => {
  setRedactAllowList(undefined);
  vi.useRealTimers();
});

describe("parseRedactAllowList", () => {
  it("accepts module:path entries and trims whitespace", () => {
    const l = parseRedactAllowList(" MobilePush:tokenPreview , UserSessionLogging:changes.fcmToken ");
    expect(l.accepted).toEqual(["MobilePush:tokenPreview", "UserSessionLogging:changes.fcmToken"]);
    expect(l.rejected).toEqual([]);
    expect(l.byModule.get("UserSessionLogging")?.has("changes.fcmToken")).toBe(true);
  });

  it("rejects wildcards, bare keys and empty halves", () => {
    const l = parseRedactAllowList("token,*:token,MobilePush:*,MobilePush:changes.*,:token,MobilePush:,a b:token");
    expect(l.accepted).toEqual([]);
    expect(l.rejected).toHaveLength(7);
  });

  it("is empty (strict) when unset or blank", () => {
    expect(parseRedactAllowList(undefined).accepted).toEqual([]);
    expect(parseRedactAllowList("  ,  ").accepted).toEqual([]);
  });
});

describe("setRedactAllowList", () => {
  it("is strict until set, and accepts a JSON array value", () => {
    expect(getRedactAllowList().accepted).toEqual([]);
    expect(setRedactAllowList(["M:token", "token"]).rejected).toEqual(["token"]);
    expect(getRedactAllowList().accepted).toEqual(["M:token"]);
    setRedactAllowList({ not: "a list" });
    expect(getRedactAllowList().accepted).toEqual([]);
  });
});

describe("syncRedactAllowList", () => {
  it("applies changes, treats null as strict and keeps the last list on failure", async () => {
    vi.useFakeTimers();
    const values: Array<unknown> = ["M:token", "M:token", new Error("down"), undefined, null];
    const fetchRaw = vi.fn(async () => {
      const v = values.shift();
      if (v instanceof Error) throw v;
      return v;
    });
    const onChange = vi.fn();
    const stop = syncRedactAllowList(fetchRaw, { intervalMs: 1000, onChange });

    await vi.advanceTimersByTimeAsync(0);
    expect(getRedactAllowList().accepted).toEqual(["M:token"]);
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(1000);
    expect(getRedactAllowList().accepted).toEqual(["M:token"]);
    expect(onChange).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(getRedactAllowList().accepted).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchRaw).toHaveBeenCalledTimes(5);
  });

  it("stays silent while the value stays empty", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const stop = syncRedactAllowList(async () => null, { intervalMs: 1000, onChange });
    await vi.advanceTimersByTimeAsync(3000);
    stop();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("shred with an allow-list", () => {
  it("strict by default: secret-named fields are redacted", () => {
    const out = shred({ module: "UserSessionLogging", changes: { fcmToken: "ios:eN****" } });
    expect(out).toEqual({ module: "UserSessionLogging", changes: { fcmToken: "[REDACTED]" } });
  });

  it("keeps exactly the allowed path, only for the named module", () => {
    setRedactAllowList("UserSessionLogging:changes.fcmToken");
    const rec = { module: "UserSessionLogging", changes: { fcmToken: "ios:eN****", accessToken: "abc123****" } };
    expect(shred(rec)).toEqual({
      module: "UserSessionLogging",
      changes: { fcmToken: "ios:eN****", accessToken: "[REDACTED]" },
    });
    // Same path under another module stays redacted.
    expect(shred({ module: "Other", changes: { fcmToken: "ios:eN****" } })).toEqual({
      module: "Other",
      changes: { fcmToken: "[REDACTED]" },
    });
    // No module => no exceptions.
    expect(shred({ changes: { fcmToken: "ios:eN****" } })).toEqual({ changes: { fcmToken: "[REDACTED]" } });
  });

  it("matches array elements without indices in the path", () => {
    setRedactAllowList("UserSessionLogging:changes.fcmToken");
    const out = shred({ module: "UserSessionLogging", changes: [{ fcmToken: "ios:a1****" }, { fcmToken: "android:b2****" }] });
    expect(out).toEqual({ module: "UserSessionLogging", changes: [{ fcmToken: "ios:a1****" }, { fcmToken: "android:b2****" }] });
  });

  it("does not allow the same key at a different depth", () => {
    setRedactAllowList("MobilePush:token");
    const out = shred({ module: "MobilePush", token: "abc123", nested: { token: "abc123" } });
    expect(out).toEqual({ module: "MobilePush", token: "abc123", nested: { token: "[REDACTED]" } });
  });

  it("still applies value patterns to allowed fields", () => {
    setRedactAllowList("MobilePush:token");
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const out = shred({ module: "MobilePush", token: `Bearer ${jwt}` }) as Record<string, string>;
    expect(out.token).not.toContain("eyJ");
    expect(out.token).toContain("[REDACTED");
  });

  it("applies to shredRecordInPlace (winston path) at top level and nested", () => {
    setRedactAllowList("UserSessionLogging:changes.voipToken,MobilePush:token");
    const a: Record<string, unknown> = { level: "info", message: "m", module: "MobilePush", token: "abc123", password: "p" };
    shredRecordInPlace(a);
    expect(a.token).toBe("abc123");
    expect(a.password).toBe("[REDACTED]");
    const b: Record<string, unknown> = { level: "info", message: "m", module: "UserSessionLogging", changes: { voipToken: "f00ba1****" } };
    shredRecordInPlace(b);
    expect(b.changes).toEqual({ voipToken: "f00ba1****" });
  });
});

describe("preview / suffix renames are kept without any allow-list", () => {
  it("keeps *Preview and *Suffix fields", () => {
    const out = shred({
      changes: { fcmTokenPreview: "ios:eN****", voipTokenPreview: "f00ba1****", refreshTokenPreview: "r1****", accessTokenPreview: "a1****" },
      tokenPreview: "abc123",
      voipTokenPreview: "def456",
      tokenSuffix: "zz9yy8",
      mentionTarget: 'data-user-id="u1"',
    });
    expect(out).toEqual({
      changes: { fcmTokenPreview: "ios:eN****", voipTokenPreview: "f00ba1****", refreshTokenPreview: "r1****", accessTokenPreview: "a1****" },
      tokenPreview: "abc123",
      voipTokenPreview: "def456",
      tokenSuffix: "zz9yy8",
      mentionTarget: 'data-user-id="u1"',
    });
  });
});
