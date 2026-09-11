import { describe, it, expect } from "vitest";
import { shred, shredRecordInPlace, isSecretKey } from "../src/shredder.js";

// A stringified clone is the easiest way to assert "no secret survives anywhere".
const flat = (v: unknown) => JSON.stringify(shred(v));

describe("isSecretKey", () => {
  it("flags secret-named keys (case/separator-insensitive)", () => {
    for (const k of ["password", "apiKey", "api_key", "x-api-key", "accessToken", "refresh_token", "clientSecret", "Authorization", "cookie", "privateKey", "jwt", "passphrase"]) {
      expect(isSecretKey(k), k).toBe(true);
    }
  });

  it("keeps safe siblings that merely share a stem", () => {
    for (const k of ["tokenPreview", "tokenPresent", "tokenSource", "tokenExp", "tokenExpiry", "totalTokens", "promptTokens", "tokenCount", "secretName", "authorizationType", "passwordLength"]) {
      expect(isSecretKey(k), k).toBe(false);
    }
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

  it("truncates over-long strings", () => {
    const out = shred({ blob: "x".repeat(20000) }) as { blob: string };
    expect(out.blob.length).toBeLessThan(20000);
    expect(out.blob).toContain("truncated");
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
