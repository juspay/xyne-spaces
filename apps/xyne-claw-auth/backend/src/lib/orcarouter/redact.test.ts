import { describe, expect, it } from "vitest";

import {
  assertNoOrcaRouterSecret,
  maskOrcaRouterKey,
  MASKED_KEY,
  redactOrcaRouterLogValue,
  redactOrcaRouterSecrets,
} from "./redact.js";

const FAKE_KEY = "sk-orca-fake-redaction-0001abcdefghijklmnop";
const FAKE_VERIFIER = "ZmFrZS12ZXJpZmllci12YWx1ZS1mb3ItdGVzdHMtMDAwMDAwMDA";

describe("maskOrcaRouterKey", () => {
  it("keeps the prefix and the last four characters only", () => {
    expect(maskOrcaRouterKey(FAKE_KEY)).toBe("sk-orca-…mnop");
  });

  it("never returns a value that still contains the key", () => {
    const masked = maskOrcaRouterKey(FAKE_KEY);
    expect(masked).not.toContain(FAKE_KEY);
    expect(masked.length).toBeLessThan(FAKE_KEY.length);
  });

  it("handles empty and non-string input", () => {
    expect(maskOrcaRouterKey("")).toBe(MASKED_KEY);
    expect(maskOrcaRouterKey(undefined)).toBe(MASKED_KEY);
    expect(maskOrcaRouterKey(null)).toBe(MASKED_KEY);
    expect(maskOrcaRouterKey(42)).toBe(MASKED_KEY);
  });
});

describe("redactOrcaRouterSecrets", () => {
  it("strips an sk-orca- key from a log line", () => {
    const line = `exchange ok for ${FAKE_KEY} (user 12)`;
    expect(redactOrcaRouterSecrets(line)).not.toContain(FAKE_KEY);
    expect(redactOrcaRouterSecrets(line)).toContain("[redacted-key]");
  });

  it("strips an assigned verifier, in JSON and in a querystring", () => {
    expect(redactOrcaRouterSecrets(`{"code_verifier":"${FAKE_VERIFIER}"}`)).not.toContain(FAKE_VERIFIER);
    expect(redactOrcaRouterSecrets(`code_verifier=${FAKE_VERIFIER}&x=1`)).not.toContain(FAKE_VERIFIER);
    expect(redactOrcaRouterSecrets(`code=${FAKE_VERIFIER}`)).not.toContain(FAKE_VERIFIER);
  });

  it("strips a bare verifier-shaped token", () => {
    expect(redactOrcaRouterSecrets(`verifier ${FAKE_VERIFIER} used`)).not.toContain(FAKE_VERIFIER);
  });

  it("leaves ordinary prose and short tokens alone", () => {
    const prose = "OrcaRouter sign-in was denied. Start again.";
    expect(redactOrcaRouterSecrets(prose)).toBe(prose);
    expect(redactOrcaRouterSecrets("")).toBe("");
  });
});

describe("redactOrcaRouterLogValue", () => {
  it("redacts nested key/verifier fields by name", () => {
    const redacted = redactOrcaRouterLogValue({
      provider: "orcarouter",
      apiKey: FAKE_KEY,
      code_verifier: FAKE_VERIFIER,
      nested: { secret: "abc", ok: true },
      list: [FAKE_KEY, "plain"],
    }) as Record<string, unknown>;
    expect(redacted["apiKey"]).toBe("[redacted]");
    expect(redacted["code_verifier"]).toBe("[redacted]");
    expect((redacted["nested"] as Record<string, unknown>)["secret"]).toBe("[redacted]");
    expect(redacted["provider"]).toBe("orcarouter");
    expect(JSON.stringify(redacted)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(redacted)).not.toContain(FAKE_VERIFIER);
  });

  it("keeps non-secret values intact", () => {
    expect(redactOrcaRouterLogValue({ status: 401, retryable: false })).toEqual({ status: 401, retryable: false });
  });
});

describe("assertNoOrcaRouterSecret (test helper)", () => {
  it("passes a clean string", () => {
    const check = assertNoOrcaRouterSecret("sign-in was denied", [FAKE_KEY, FAKE_VERIFIER]);
    expect(check).toEqual({ containsNoSecret: true, leaked: [] });
  });

  it("flags the exact secret it found", () => {
    const check = assertNoOrcaRouterSecret(`oops ${FAKE_VERIFIER}`, [FAKE_KEY, FAKE_VERIFIER]);
    expect(check.containsNoSecret).toBe(false);
    expect(check.leaked).toContain(FAKE_VERIFIER);
  });

  it("flags any sk-orca-shaped key even when it was not named", () => {
    const check = assertNoOrcaRouterSecret(`body ${FAKE_KEY}`, []);
    expect(check.containsNoSecret).toBe(false);
  });
});
