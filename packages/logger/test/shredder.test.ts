import { describe, it, expect } from "vitest";
import { shred, shredText, shredRecordInPlace, shredError, isSecretKey, CLIENT_EVENT_SHRED_OPTIONS } from "../src/shredder.js";

// A stringified clone is the easiest way to assert "no secret survives anywhere".
const flat = (v: unknown) => JSON.stringify(shred(v));

describe("isSecretKey", () => {
  it("flags secret-named keys (case/separator-insensitive)", () => {
    for (const k of ["password", "apiKey", "api_key", "x-api-key", "accessToken", "refresh_token", "clientSecret", "Authorization", "cookie", "privateKey", "jwt", "passphrase",
      // Separator-less / header / env / nested-change forms seen in prod logs.
      "accesstoken", "xapikey", "set-cookie", "OPENAI_API_KEY", "GITHUB_TOKEN", "fcmToken", "voipToken", "refreshToken", "private_key", "passwordHash", "retryToken", "token", "cookies", "credentials"]) {
      expect(isSecretKey(k), k).toBe(true);
    }
  });

  it("keeps safe siblings that merely share a stem", () => {
    for (const k of ["tokenPreview", "tokenPresent", "tokenSource", "tokenExp", "tokenExpiry", "totalTokens", "promptTokens", "tokenCount", "secretName", "authorizationType", "passwordLength",
      // Real non-secret field names from the 25–28 Sep prod/pre-prod/SDLC replay.
      "tokenEmail", "tokenSub", "tokensIn", "tokensOut", "tokensTried", "tokenSuffix", "cookieNames", "tokenWorkspaceId",
      "fcmTokenPreview", "voipTokenPresent", "workspaceTokenPresent", "cookieTokenPresent", "accessTokenExpiresAt", "tokenizer"]) {
      expect(isSecretKey(k), k).toBe(false);
    }
  });
});

describe("shred — boolean has*/is* flags", () => {
  it("keeps boolean has*/is* flags even when they name a secret", () => {
    const out = shred({ hasBroadcastToken: true, hasToken: false, has_private_key: true, hasCookieHeader: true, isTokenValid: false }) as Record<string, unknown>;
    expect(out).toEqual({ hasBroadcastToken: true, hasToken: false, has_private_key: true, hasCookieHeader: true, isTokenValid: false });
    const rec = shredRecordInPlace({ message: "m", hasToken: true } as Record<string, unknown>);
    expect(rec.hasToken).toBe(true);
  });

  it("still redacts a has*/is* key whose value is NOT a boolean", () => {
    const out = shred({ hasToken: "ya29.real-token-value", isSecret: "s3cr3t-value" }) as Record<string, unknown>;
    expect(out.hasToken).toBe("[REDACTED]");
    expect(out.isSecret).toBe("[REDACTED]");
  });

  it("keeps the replayed auth-middleware / LLM / notification fields", () => {
    const out = shred({ tokenEmail: "a@juspay.in", tokenSub: "u_1", tokensIn: 1200, tokensOut: 300, tokensTried: 2, cookieNames: ["a", "b"], changes: { fcmToken: "real-device-token" } }) as Record<string, any>;
    expect(out.tokenEmail).toBe("a@juspay.in");
    expect(out.tokenSub).toBe("u_1");
    expect(out.tokensIn).toBe(1200);
    expect(out.tokensOut).toBe(300);
    expect(out.tokensTried).toBe(2);
    expect(out.cookieNames).toEqual(["a", "b"]);
    expect(out.changes.fcmToken).toBe("[REDACTED]");
  });
});

describe("shred — key detector", () => {
  it("redacts a secret-named field wholesale, including nested objects", () => {
    const out = flat({ apiKey: "sk-abcdef0123456789abcd", credentials: { password: "hunter2", nested: { token: "zzzz" } } });
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("sk-abcdef");
    expect(out).not.toContain("zzzz");
    expect(out).toContain("[REDACTED]");
  });

  it("keeps safe-sibling values", () => {
    const out = shred({ tokenPreview: "sk-1", totalTokens: 42, apiKeySource: "env" }) as Record<string, unknown>;
    expect(out.tokenPreview).toBe("sk-1");
    expect(out.totalTokens).toBe(42);
    expect(out.apiKeySource).toBe("env");
  });
});

describe("shred — value detector", () => {
  // [name, input, marker the output must contain, raw secret that must be gone]
  const cases: Array<[string, string, string, string]> = [
    ["Bearer", "Authorization: Bearer abcDEF123456ghijkl", "Bearer [REDACTED]", "abcDEF123456ghijkl"],
    ["JWT", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c", "[REDACTED_JWT]", "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"],
    ["sk- key", "using key sk-abcdefghij0123456789ABCD", "[REDACTED_KEY]", "sk-abcdefghij0123456789ABCD"],
    ["AWS", "id=AKIAIOSFODNN7EXAMPLE done", "[REDACTED_AWS_KEY]", "AKIAIOSFODNN7EXAMPLE"],
    ["GitHub", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "[REDACTED_KEY]", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["Slack", "xoxb-123456789012-abcdefghijklmno", "[REDACTED_KEY]", "xoxb-123456789012-abcdefghijklmno"],
    ["inline", "connect password=SuperSecret1 ok", "password", "SuperSecret1"],
  ];
  for (const [name, input, marker, rawSecret] of cases) {
    it(`redacts ${name} even under an innocent key`, () => {
      const out = flat({ note: input });
      expect(out, `${name}: expected marker`).toContain(marker);
      expect(out, `${name}: raw secret must be gone`).not.toContain(rawSecret);
    });
  }

  it("redacts a PEM private key block", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1234\n-----END RSA PRIVATE KEY-----";
    const out = flat({ key: pem });
    expect(out).toContain("[REDACTED_PEM]");
    expect(out).not.toContain("MIIEpAIBAAKCAQEA1234");
  });
});

describe("shred — Bearer rule", () => {
  it("does not mangle prose after the word bearer", () => {
    expect(shredText("upstream bearer returned 401")).toBe("upstream bearer returned 401");
    expect(shredText("Bearer authentication required")).toBe("Bearer authentication required");
  });
  it("redacts real bearer tokens (has a digit, or 20+ chars)", () => {
    expect(shredText("Authorization: Bearer ya29a0AfB1x2")).toBe("Authorization: Bearer [REDACTED]");
    expect(shredText("Bearer abcdefghijklmnopqrstuvwxyz")).toBe("Bearer [REDACTED]");
  });
  it("always redacts the value of an Authorization: Bearer header, even letters-only", () => {
    expect(shredText("Authorization: Bearer abcdefghijklmnop")).toBe("Authorization: Bearer [REDACTED]");
    expect(shredText('{"authorization":"Bearer abcdefghijklmnop"}')).toBe('{"authorization":"Bearer [REDACTED]"}');
  });
});

describe("shred — error handling", () => {
  it("serialises Error with redacted message + stack", () => {
    const err = new Error("token=abcdef123456 failed");
    const out = shred({ err }) as { err: { name: string; message: string; stack?: string } };
    expect(out.err.name).toBe("Error");
    expect(out.err.message).not.toContain("abcdef123456");
    expect(out.err.message).toContain("[REDACTED]");
  });
});

describe("shred — structural safety", () => {
  it("is cycle-safe", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => shred(a)).not.toThrow();
    expect(JSON.stringify(shred(a))).toContain("[Circular]");
  });

  it("caps deep nesting instead of recursing forever", () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 100; i++) {
      const next: Record<string, unknown> = {};
      deep.child = next;
      deep = next;
    }
    const out = JSON.stringify(shred(root));
    expect(out).toContain("[Object]");
  });

  it("keeps strings up to the 64 KB default intact", () => {
    const out = shred({ blob: "x".repeat(65536) }) as { blob: string };
    expect(out.blob).toBe("x".repeat(65536));
  });

  it("truncates strings over the 64 KB default", () => {
    const out = shred({ blob: "x".repeat(70000) }) as { blob: string };
    expect(out.blob.startsWith("x".repeat(65536) + "…[truncated 4464 chars]")).toBe(true);
    expect(shredText("y".repeat(70000))).toContain("[truncated 4464 chars]");
  });

  it("truncates Error stacks over 64 KB by default", () => {
    const err = new Error("boom");
    err.stack = "s".repeat(70000);
    const out = shred({ err }) as { err: { stack: string } };
    expect(out.err.stack).toContain("[truncated");
  });

  it("caps very large arrays", () => {
    const out = shred(new Array(5000).fill(1)) as unknown[];
    expect(out.length).toBeLessThan(5000);
    expect(String(out[out.length - 1])).toContain("more");
  });

  it("handles Map/Set/BigInt/Date/Buffer without throwing", () => {
    const out = shred({
      m: new Map([["k", "v"]]),
      s: new Set([1, 2]),
      big: 10n,
      when: new Date("2020-01-01T00:00:00.000Z"),
      buf: Buffer.from("hi"),
    }) as Record<string, unknown>;
    expect((out.m as Record<string, unknown>).k).toBe("v");
    expect(out.s).toEqual([1, 2]);
    expect(out.big).toBe("10");
    expect(out.when).toBe("2020-01-01T00:00:00.000Z");
    expect(String(out.buf)).toContain("Buffer");
  });

  it("never throws on hostile input", () => {
    const hostile = { get bad() { throw new Error("boom"); } };
    expect(() => shred(hostile)).not.toThrow();
  });

  it("strips newlines/control chars so values can't forge new log lines (log injection)", () => {
    const out = shred({ note: "ok\nFAKE 2020 ERROR admin login\r\nx\tYZ" }) as { note: string };
    expect(out.note).not.toMatch(/[\n\r\t]/);
    expect(out.note).toContain("FAKE");          // content kept, just flattened to one line
  });

  it("does not pollute Object.prototype via a malicious __proto__ key (prototype pollution)", () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}, "safe": 1}');
    const out = shred(malicious) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined(); // global proto untouched
    expect(out.safe).toBe(1);
    expect(out.__proto__).not.toMatchObject({ polluted: true });
  });
});

describe("shredRecordInPlace — frozen contract", () => {
  it("keeps contract field NAMES and non-secret values, redacts message secrets, leaves level/timestamp", () => {
    const record: Record<string, unknown> = {
      level: "info",
      timestamp: "2026-09-10 10:00:00",
      message: "login for Bearer abc123DEF456ghi789",
      emailId: "a@b.com",
      userId: "u_123",
      container: "xyne-logging-bridge",
      event: "enrollment_screen_landed",
      apiKey: "sk-shouldbegone0123456789",
    };
    const out = shredRecordInPlace(record);
    // Structural keys untouched.
    expect(out.level).toBe("info");
    expect(out.timestamp).toBe("2026-09-10 10:00:00");
    // PII / contract fields survive unchanged (Case A — keep PII).
    expect(out.emailId).toBe("a@b.com");
    expect(out.userId).toBe("u_123");
    expect(out.container).toBe("xyne-logging-bridge");
    expect(out.event).toBe("enrollment_screen_landed");
    // Secret key redacted, secret in message redacted.
    expect(out.apiKey).toBe("[REDACTED]");
    expect(String(out.message)).toContain("Bearer [REDACTED]");
    expect(String(out.message)).not.toContain("abc123DEF456ghi789");
  });

  it("preserves symbol keys (winston internals) untouched", () => {
    const sym = Symbol.for("splat");
    const record: Record<string | symbol, unknown> = { message: "hi", [sym]: ["extra"] };
    shredRecordInPlace(record as Record<string, unknown>);
    expect(record[sym]).toEqual(["extra"]);
  });
});

describe("shred — retryToken truncation note", () => {
  // provider-retry-worker.ts logs a full internal capability token under
  // `retryToken`. `token` stem => redacted by the key detector.
  it("redacts a retryToken field", () => {
    const out = shred({ retryToken: "cap_abcdefghijklmnop" }) as { retryToken: string };
    expect(out.retryToken).toBe("[REDACTED]");
  });
});

describe("shred — client events (CLIENT_EVENT_SHRED_OPTIONS)", () => {
  it("does not truncate large client crash reports", () => {
    const stack = "at frame\n".repeat(12000); // ~108 KB, like lotus_crash_detected
    const out = shred({ event: "lotus_crash_detected", stack }, CLIENT_EVENT_SHRED_OPTIONS) as { stack: string };
    expect(out.stack).not.toContain("truncated");
    expect(out.stack.length).toBe(stack.length);
  });

  it("still redacts secrets in client events", () => {
    const out = shred(
      { accessToken: "abc123abc123", note: "Authorization: Bearer abcdefghijklmnop", blob: "z".repeat(100000) },
      CLIENT_EVENT_SHRED_OPTIONS,
    ) as { accessToken: string; note: string; blob: string };
    expect(out.accessToken).toBe("[REDACTED]");
    expect(out.note).toContain("Bearer [REDACTED]");
    expect(out.blob.length).toBe(100000);
  });
});

const PROBE = "Bearer zzPROBEzz1234567890abcdef";

describe("shredRecordInPlace leaves no field unchecked", () => {
  it("redacts a secret in every string key except winston-owned `level`", () => {
    const err = new Error(`boom ${PROBE}`);
    const rec: Record<string, unknown> = {
      level: "info",
      message: `m ${PROBE}`,
      timestamp: PROBE,
      stack: PROBE,
      module: PROBE,
      service: PROBE,
      requestId: PROBE,
      detail: PROBE,
      apiKey: "raw",
      details: ["ok", PROBE],
      nested: { deeper: { detail: PROBE } },
      map: new Map([["detail", PROBE]]),
      error: err,
    };
    shredRecordInPlace(rec);
    expect(JSON.stringify(rec)).not.toContain("zzPROBEzz");
    expect(rec.level).toBe("info");
    expect(rec.apiKey).toBe("[REDACTED]");
  });

  it("redacts a non-string message", () => {
    const rec: Record<string, unknown> = { level: "info", message: { detail: PROBE } };
    shredRecordInPlace(rec);
    expect(JSON.stringify(rec)).not.toContain("zzPROBEzz");
  });
});

describe("timestamp is checked but never altered when it is a real time", () => {
  it("keeps caller-supplied ISO and claw-format timestamps byte for byte", () => {
    for (const ts of ["2026-10-09T10:00:00.000Z", "2026-10-09 15:30:00", "15:30:00", "1760000000000", new Date(0).toString()]) {
      const rec: Record<string, unknown> = { level: "info", message: "analytics_event", timestamp: ts };
      shredRecordInPlace(rec);
      expect(rec.timestamp).toBe(ts);
    }
  });

  it("leaves Date and number timestamps untouched (same type and value)", () => {
    const d = new Date(0);
    const a: Record<string, unknown> = { level: "info", message: "m", timestamp: d };
    const b: Record<string, unknown> = { level: "info", message: "m", timestamp: 1760000000000 };
    shredRecordInPlace(a);
    shredRecordInPlace(b);
    expect(a.timestamp).toBe(d);
    expect(b.timestamp).toBe(1760000000000);
  });

  it("redacts a secret hidden in timestamp", () => {
    const rec: Record<string, unknown> = { level: "info", message: "m", timestamp: PROBE };
    shredRecordInPlace(rec);
    expect(rec.timestamp).toBe("Bearer [REDACTED]");
  });
});

describe("shredError", () => {
  it("returns an Error with a multi-line, redacted stack and message", () => {
    const err = new Error(`connect failed ${PROBE}`);
    const out = shredError(err);
    expect(out).toBeInstanceOf(Error);
    expect(out.name).toBe("Error");
    expect(out.message).toBe("connect failed Bearer [REDACTED]");
    expect(out.stack).toContain("\n    at ");
    expect(out.stack).not.toContain("zzPROBEzz");
    expect(err.message).toContain("zzPROBEzz");
  });

  it("redacts a PEM block that spans lines and shreds extra fields", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    const err = Object.assign(new Error(`bad key\n${pem}`), { code: "EKEY", token: "raw" });
    const out = shredError(err) as Error & { code?: string; token?: string };
    expect(out.message).toBe("bad key\n[REDACTED_PEM]");
    expect(out.code).toBe("EKEY");
    expect(out.token).toBe("[REDACTED]");
  });
});
