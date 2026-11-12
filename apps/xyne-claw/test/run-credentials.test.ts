import { describe, expect, it } from "vitest";
import { useRuntimeTestKey } from "./runtime-test-key.js";
import { clawAuthHeaders, withRunSessionToken } from "../src/run-credentials.js";

useRuntimeTestKey();

const claims = (h: Record<string, string>) =>
  JSON.parse(Buffer.from(h["x-service-assertion"]!.split(".")[1]!, "base64url").toString("utf8"));

describe("clawAuthHeaders", () => {
  it("signs as the runtime for claw-auth, bound to method + path, never a shared key", () => {
    const h = clawAuthHeaders("POST", "http://auth:3003/claw/api/v1/internal/connectors/available?x=1");
    expect(h["x-s2s-key"]).toBeUndefined();
    expect(h["x-user-id"]).toBeUndefined();
    expect(claims(h)).toMatchObject({ iss: "xyne-claw", aud: "xyne-claw-auth", htm: "POST", htu: "/claw/api/v1/internal/connectors/available" });
  });

  it("adds the current run's session token, and each call gets a fresh one-shot assertion", () => {
    withRunSessionToken("run-tok", () => {
      const a = clawAuthHeaders("GET", "http://auth/claw/api/v1/x");
      const b = clawAuthHeaders("GET", "http://auth/claw/api/v1/x");
      expect(a["x-session-token"]).toBe("run-tok");
      expect(claims(a).jti).not.toBe(claims(b).jti);
    });
    expect(clawAuthHeaders("GET", "http://auth/claw/api/v1/x")["x-session-token"]).toBeUndefined();
  });

  it("fails closed without a key: sends nothing instead of throwing", () => {
    const saved = process.env["CLAW_RUNTIME_PRIVATE_KEY"];
    delete process.env["CLAW_RUNTIME_PRIVATE_KEY"];
    try {
      expect(clawAuthHeaders("POST", "http://auth/claw/api/v1/x")).toEqual({});
    } finally {
      process.env["CLAW_RUNTIME_PRIVATE_KEY"] = saved;
    }
  });
});
