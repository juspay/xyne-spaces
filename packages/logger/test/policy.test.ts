import { afterEach, describe, expect, it, vi } from "vitest";
import { isSecretKey, shred, shredError, shredRecordInPlace, shredText } from "../src/shredder.js";
import { FALLBACK_KEY_WORDS, getRedactConfig, parseRedactConfig, setRedactConfig, syncRedactConfig } from "../src/policy.js";

const allow = (...allowPaths: string[]) => setRedactConfig({ allowPaths });

afterEach(() => {
  setRedactConfig(undefined);
  vi.useRealTimers();
});

describe("parseRedactConfig", () => {
  it("uses no exceptions and the fallback lists when unset, blank or not an object", () => {
    for (const raw of [undefined, null, "", "not json", ["otp"], 42]) {
      const c = parseRedactConfig(raw);
      expect(c.accepted).toEqual([]);
      expect(c.value).toBeNull();
      expect(c.allowPaths.size).toBe(0);
      expect([...c.secretWords]).toEqual(FALLBACK_KEY_WORDS.secretWords);
    }
    expect(parseRedactConfig("not json").rejected).toEqual(["not json"]);
  });

  it("accepts allow paths and word lists from an object or JSON string", () => {
    const value = { allowPaths: ["MobilePush:deviceToken"], secretWords: ["otp", " pin "], secretWordPairs: ["client secret"] };
    for (const raw of [value, JSON.stringify(value)]) {
      const c = parseRedactConfig(raw);
      expect(c.accepted).toEqual(["allowPaths:MobilePush:deviceToken", "secretWordPairs:client secret", "secretWords:otp", "secretWords:pin"]);
      expect(c.rejected).toEqual([]);
      expect(c.value).toEqual({ allowPaths: ["MobilePush:deviceToken"], secretWords: ["otp", "pin"], secretWordPairs: ["client secret"] });
    }
  });

  it("rejects wildcards, regexes, wrong shapes and unknown fields; those lists keep the fallback", () => {
    const c = parseRedactConfig({
      allowPaths: ["token", "*:token", "MobilePush:*", ":token", "a b:token"],
      secretWords: ["(a+)+$", "Token", "two words", 7],
      secretWordPairs: ["single"],
      safeLastWords: "hash",
      valuePatterns: ["xyz"],
    });
    expect(c.accepted).toEqual([]);
    expect(c.rejected).toHaveLength(12);
    expect(c.value).toBeNull();
    expect([...c.secretWords]).toEqual(FALLBACK_KEY_WORDS.secretWords);
  });
});

describe("prototype safety", () => {
  it("rejects __proto__ / constructor / toString keys and never writes them", () => {
    const c = parseRedactConfig('{"__proto__": ["x"], "constructor": ["y"], "toString": ["z"], "secretWords": ["otp"]}');
    expect(c.rejected).toEqual(["__proto__", "constructor", "toString"]);
    expect(c.value).toEqual({ secretWords: ["otp"] });
    expect(Object.getPrototypeOf(c.value)).toBe(Object.prototype);
    expect(c.accepted).toEqual(["secretWords:otp"]);
  });
});

describe("word lists", () => {
  it("the fallback reproduces the detector's documented behaviour", () => {
    for (const k of ["password", "accessToken", "x-api-key", "privateKey", "pass_phrase", "setcookie", "clientsecret"]) expect(isSecretKey(k)).toBe(true);
    for (const k of ["tokenPreview", "tokensIn", "cookieNames", "tokenCount", "fcmTokenSuffix"]) expect(isSecretKey(k)).toBe(false);
  });

  it("a list from config replaces its fallback; other lists keep theirs", () => {
    setRedactConfig({ secretWords: ["otp"] });
    expect(isSecretKey("otpCode")).toBe(true);
    expect(isSecretKey("pwd")).toBe(false);
    expect(isSecretKey("accesstoken")).toBe(true); // gluedSecretSuffixes: fallback
    expect(isSecretKey("otpPreview")).toBe(false); // safeLastWords: fallback
  });

  it("an explicit empty list empties it", () => {
    setRedactConfig({ safeLastWords: [] });
    expect(isSecretKey("tokenPreview")).toBe(true);
  });

  it("covers pairs, glued suffixes, safe last words and boolean prefixes", () => {
    setRedactConfig({
      secretWords: ["token"],
      secretWordPairs: ["session key"],
      gluedSecretSuffixes: ["sessionkey"],
      safeLastWords: ["hash"],
      booleanFlagPrefixes: ["can"],
    });
    expect(isSecretKey("x-session-key")).toBe(true);
    expect(isSecretKey("xsessionkey")).toBe(true);
    expect(isSecretKey("accesstoken")).toBe(false);
    expect(isSecretKey("tokenHash")).toBe(false);
    expect(shred({ canUseToken: true, hasToken: true })).toEqual({ canUseToken: true, hasToken: "[REDACTED]" });
  });

  it("the value detector still runs on fields the word lists keep", () => {
    setRedactConfig({ secretWords: ["otp"], safeLastWords: ["hash"] });
    expect(shred({ otp: "123456", tokenHash: "Bearer zz1234567890abcdef" })).toEqual({ otp: "[REDACTED]", tokenHash: "Bearer [REDACTED]" });
  });
});

describe("allow paths", () => {
  it("keeps exactly the allowed path, only for the named module", () => {
    allow("UserSessionLogging:changes.fcmToken");
    expect(shred({ module: "UserSessionLogging", changes: { fcmToken: "ios:eN****", accessToken: "a1****" } })).toEqual({
      module: "UserSessionLogging",
      changes: { fcmToken: "ios:eN****", accessToken: "[REDACTED]" },
    });
    expect(shred({ module: "Other", changes: { fcmToken: "x" } })).toEqual({ module: "Other", changes: { fcmToken: "[REDACTED]" } });
    expect(shred({ changes: { fcmToken: "x" } })).toEqual({ changes: { fcmToken: "[REDACTED]" } });
  });

  it("matches array elements, not other depths", () => {
    allow("M:changes.fcmToken", "M:token");
    expect(shred({ module: "M", changes: [{ fcmToken: "a" }, { fcmToken: "b" }], nested: { token: "c" } })).toEqual({
      module: "M",
      changes: [{ fcmToken: "a" }, { fcmToken: "b" }],
      nested: { token: "[REDACTED]" },
    });
  });

  it("still applies value patterns", () => {
    allow("M:token");
    // Assembled at runtime so secret scanners don't flag a literal bearer header.
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0In0", "dozjgNryP4J3jVmN"].join(".");
    const out = shred({ module: "M", token: `Bearer ${jwt}` }) as Record<string, string>;
    expect(out.token).not.toContain("eyJ");
  });

  it("applies to shredRecordInPlace", () => {
    allow("M:token");
    const rec: Record<string, unknown> = { level: "info", message: "m", module: "M", token: "abc123", password: "p" };
    shredRecordInPlace(rec);
    expect(rec).toMatchObject({ token: "abc123", password: "[REDACTED]" });
  });

  it("beats a configured secret word (the canary test)", () => {
    setRedactConfig({ allowPaths: ["logger:redactCanary"], secretWords: [...FALLBACK_KEY_WORDS.secretWords, "canary"] });
    expect(shred({ module: "logger", redactCanary: "visible" })).toEqual({ module: "logger", redactCanary: "visible" });
    expect(shred({ module: "other", redactCanary: "visible" })).toEqual({ module: "other", redactCanary: "[REDACTED]" });
  });
});

describe("enabled kill switch", () => {
  it("false runs only main's legacy patterns, on every string including nested ones", () => {
    setRedactConfig({ enabled: false });
    const bearer = ["Bearer", "zz1234567890abcdef"].join(" ");
    const obj = { password: "hunter2", nested: { auth: bearer } };
    expect(shred(obj)).toEqual({ password: "hunter2", nested: { auth: "Bearer [REDACTED]" } }); // no key detector
    expect(obj.nested.auth).toBe(bearer); // input not mutated
    expect(shred(`x ${bearer}`)).toBe("x Bearer [REDACTED]");
    expect(shredText("call token=abcd1234 done")).toBe("call token=[REDACTED] done");
    const err = new Error(bearer);
    expect(shredError(err)).toBe(err);
    const rec: Record<string, unknown> = { level: "info", message: `m ${bearer}`, password: "hunter2", key: "api_key=abcdefabcdef12", nested: { auth: bearer } };
    shredRecordInPlace(rec);
    expect(rec).toEqual({ level: "info", message: "m Bearer [REDACTED]", password: "hunter2", key: "api_key=[REDACTED]", nested: { auth: "Bearer [REDACTED]" } });
  });

  it("false is never weaker than main's claw redactValue (nested objects and arrays)", () => {
    setRedactConfig({ enabled: false });
    const bearer = ["Bearer", "abcd1234efgh5678ijkl"].join(" ");
    const sk = ["sk", "abcdefghij0123456789"].join("-");
    const meta = { detail: bearer, url: "https://x.io/?api_key=ABCD1234EFGH5678", list: [sk] };
    const expected = { detail: "Bearer [REDACTED]", url: "https://x.io/?api_key=[REDACTED]", list: ["[REDACTED]"] };
    expect(shred({ meta })).toEqual({ meta: expected });
    const rec: Record<string, unknown> = { message: "m", meta };
    expect(shredRecordInPlace(rec)).toEqual({ message: "m", meta: expected });
  });

  it("false survives circular records", () => {
    setRedactConfig({ enabled: false });
    const a: Record<string, unknown> = { s: "token=abcd1234" };
    a.self = a;
    expect(shred(a)).toEqual({ s: "token=[REDACTED]", self: "[Circular]" });
  });

  it("is relayed downstream and shows in accepted", () => {
    const c = parseRedactConfig({ enabled: false, secretWords: ["otp"] });
    expect(c.value).toEqual({ enabled: false, secretWords: ["otp"] });
    expect(c.accepted).toEqual(["enabled:false", "secretWords:otp"]);
  });

  it("true, absent or a non-boolean keeps redaction on", () => {
    for (const raw of [{ enabled: true }, {}, { enabled: "false" }, { enabled: 0 }]) {
      setRedactConfig(raw);
      expect(shred({ password: "hunter2" })).toEqual({ password: "[REDACTED]" });
    }
    expect(parseRedactConfig({ enabled: "false" }).rejected).toEqual(['enabled:"false"']);
  });
});

describe("syncRedactConfig", () => {
  it("applies changes, treats null as the fallback and keeps the last value on failure", async () => {
    vi.useFakeTimers();
    const v = { allowPaths: ["M:token"], secretWords: ["otp"] };
    const values: Array<unknown> = [v, JSON.stringify(v), new Error("down"), undefined, null];
    const fetchRaw = vi.fn(async () => {
      const next = values.shift();
      if (next instanceof Error) throw next;
      return next;
    });
    const onChange = vi.fn();
    const stop = syncRedactConfig(fetchRaw, { intervalMs: 1000, onChange });

    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(1000);
    expect(getRedactConfig().accepted).toEqual(["allowPaths:M:token", "secretWords:otp"]);
    expect(onChange).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(getRedactConfig().value).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchRaw).toHaveBeenCalledTimes(5);
  });

  it("stays silent while the value stays empty", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const stop = syncRedactConfig(async () => null, { intervalMs: 1000, onChange });
    await vi.advanceTimersByTimeAsync(3000);
    stop();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("preview / suffix fields are kept without any allow path", () => {
  it("keeps *Preview and *Suffix fields", () => {
    const rec = { changes: { fcmTokenPreview: "ios:eN****", accessTokenPreview: "a1****" }, tokenPreview: "abc123", tokenSuffix: "zz9yy8" };
    expect(shred(rec)).toEqual(rec);
  });
});
