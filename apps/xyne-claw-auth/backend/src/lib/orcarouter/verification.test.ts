// The existing verification path must reach OrcaRouter's INFERENCE origin with
// Bearer auth — the api-key choice is validated by shape only, and real
// validity is established here (or by the first real request).
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../mcpgateway/services/http-client.js", () => ({
  assertSafeOutboundUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../logger.js", () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));

import { verifyProviderCredential } from "../provider-credential-verify.js";

interface FetchCall {
  url: string;
  headers: Record<string, string>;
}

let calls: FetchCall[] = [];

function respond(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers ?? {} });
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
}

afterEach(() => {
  calls = [];
  vi.unstubAllGlobals();
});

const FAKE_KEY = "sk-orca-fake-verify-0001";

describe("verifyProviderCredential — orcarouter", () => {
  it("lists models from the inference origin with Bearer auth", async () => {
    respond(200, { data: [{ id: "orcarouter/auto" }] });
    const result = await verifyProviderCredential(
      { provider: "orcarouter", apiKey: FAKE_KEY, authType: "api_key" },
      "https://grid.example.com",
    );
    expect(result).toEqual({ ok: true, models: [{ id: "orcarouter/auto", name: "orcarouter/auto" }] });
    expect(calls[0]?.url).toBe("https://api.orcarouter.ai/v1/models");
    expect(calls[0]?.headers["Authorization"]).toBe(`Bearer ${FAKE_KEY}`);
  });

  it("never sends the key to the auth origin", async () => {
    respond(200, { data: [] });
    await verifyProviderCredential({ provider: "orcarouter", apiKey: FAKE_KEY }, "https://grid.example.com");
    expect(calls[0]?.url).not.toContain("www.orcarouter.ai");
    expect(calls[0]?.url).not.toContain("auth/keys");
  });

  it("quotes the provider by name when it rejects the key", async () => {
    respond(401, { error: { message: "invalid key" } });
    const result = await verifyProviderCredential({ provider: "orcarouter", apiKey: FAKE_KEY }, "");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("rejected");
    expect(result.message).toBe("OrcaRouter rejected this key: invalid key");
  });

  it("honours an explicit baseUrl override", async () => {
    respond(200, { data: [] });
    await verifyProviderCredential(
      { provider: "orcarouter", apiKey: FAKE_KEY, baseUrl: "https://api.internal.example/v1/" },
      "",
    );
    expect(calls[0]?.url).toBe("https://api.internal.example/v1/models");
  });
});
