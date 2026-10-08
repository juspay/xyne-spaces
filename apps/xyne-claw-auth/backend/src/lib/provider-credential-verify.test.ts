import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractProviderMessage,
  modelServedBy,
  providerNeedsKey,
  verifyProviderCredential,
} from "./provider-credential-verify.js";

vi.mock("../mcpgateway/services/http-client.js", () => ({
  assertSafeOutboundUrl: vi.fn().mockResolvedValue(undefined),
}));

const LITELLM_BASE = "https://grid.example.com";

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

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyProviderCredential", () => {
  it("accepts a key the provider serves models for", async () => {
    respond(200, { data: [{ id: "claude-opus-4-8", display_name: "Opus" }] });
    const result = await verifyProviderCredential(
      { provider: "claude", apiKey: "sk-real", authType: "api_key" },
      LITELLM_BASE,
    );
    expect(result).toEqual({ ok: true, models: [{ id: "claude-opus-4-8", name: "Opus" }] });
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/models");
    expect(calls[0]?.headers["x-api-key"]).toBe("sk-real");
  });

  it("rejects a key the provider refuses, and quotes the provider", async () => {
    respond(401, { error: { message: "invalid x-api-key" } });
    const result = await verifyProviderCredential(
      { provider: "claude", apiKey: "sk-typo", authType: "api_key" },
      LITELLM_BASE,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("rejected");
    expect(result.status).toBe(401);
    expect(result.message).toBe("Anthropic rejected this key: invalid x-api-key");
  });

  it("reports a 5xx as unreachable, not as a bad key", async () => {
    respond(503, { error: "upstream unavailable" });
    const result = await verifyProviderCredential(
      { provider: "claude", apiKey: "sk-real", authType: "api_key" },
      LITELLM_BASE,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("unreachable");
  });

  it("reports a network failure as unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    );
    const result = await verifyProviderCredential(
      { provider: "litellm", apiKey: "sk-real" },
      LITELLM_BASE,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("unreachable");
  });

  it("sends an Anthropic OAuth token as a bearer, not as x-api-key", async () => {
    respond(200, { data: [] });
    await verifyProviderCredential(
      { provider: "claude", apiKey: "oauth-token", authType: "oauth_token" },
      LITELLM_BASE,
    );
    expect(calls[0]?.headers["Authorization"]).toBe("Bearer oauth-token");
    expect(calls[0]?.headers["x-api-key"]).toBeUndefined();
  });

  it("checks a LiteLLM key against its own gateway", async () => {
    respond(200, { data: [{ id: "kimi-latest" }] });
    const result = await verifyProviderCredential(
      { provider: "litellm", apiKey: "sk-grid", baseUrl: "https://custom.gateway/" },
      LITELLM_BASE,
    );
    expect(calls[0]?.url).toBe("https://custom.gateway/models");
    expect(result).toEqual({ ok: true, models: [{ id: "kimi-latest", name: "kimi-latest" }] });
  });

  it("refuses an empty key without calling out", async () => {
    respond(200, { data: [] });
    const result = await verifyProviderCredential({ provider: "claude", apiKey: "  " }, LITELLM_BASE);
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("has nothing to verify for the keyless platform provider", async () => {
    const result = await verifyProviderCredential({ provider: "spaces", apiKey: "" }, LITELLM_BASE);
    expect(result).toEqual({ ok: true, models: [] });
    expect(providerNeedsKey("spaces")).toBe(false);
  });
});

describe("modelServedBy", () => {
  const models = [{ id: "claude-opus-4-8", name: "Opus" }];

  it("accepts a model the key serves", () => {
    expect(modelServedBy(models, "claude-opus-4-8")).toBe(true);
  });

  it("rejects a model the key does not serve", () => {
    expect(modelServedBy(models, "gpt-5.5")).toBe(false);
  });

  it("stays out of the way when no model is pinned or none could be listed", () => {
    expect(modelServedBy(models, null)).toBe(true);
    expect(modelServedBy([], "anything")).toBe(true);
  });
});

describe("extractProviderMessage", () => {
  it("pulls Anthropic's message out of its error envelope", () => {
    const body = JSON.stringify({
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
      request_id: "req_011Cf913ovV2HvmTGxnx2xQr",
    });
    expect(extractProviderMessage(body)).toBe("invalid x-api-key");
  });

  it("pulls OpenAI's message and drops the rest of the envelope", () => {
    const body = JSON.stringify({
      error: {
        message: "Incorrect API key provided: k. You can find your API key at https://platform.openai.com/account/api-keys.",
        type: "invalid_request_error",
        param: null,
        code: "invalid_api_key",
      },
    });
    expect(extractProviderMessage(body)).toBe(
      "Incorrect API key provided: k. You can find your API key at https://platform.openai.com/account/api-keys.",
    );
  });

  it("reads a plain-string error field", () => {
    expect(extractProviderMessage(JSON.stringify({ error: "Unauthorized" }))).toBe("Unauthorized");
  });

  it("collapses a plain-text body to one line", () => {
    expect(extractProviderMessage("Forbidden\n  by policy ")).toBe("Forbidden by policy");
  });

  it("truncates a wall of text rather than pasting it into the card", () => {
    const long = "x".repeat(400);
    const extracted = extractProviderMessage(JSON.stringify({ error: { message: long } }));
    expect(extracted.length).toBeLessThanOrEqual(160);
    expect(extracted.endsWith("…")).toBe(true);
  });

  it("says nothing rather than dumping JSON it cannot read", () => {
    expect(extractProviderMessage(JSON.stringify({ weird: { shape: 1 } }))).toBe("");
    expect(extractProviderMessage("")).toBe("");
  });
});
