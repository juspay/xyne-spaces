import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../logger.js", () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));

import {
  apiKeyCredentialSource,
  credentialSource,
  describeCredentialSources,
  isWellFormedOrcaRouterKey,
  OrcaRouterCredentialError,
  pkceCredentialSource,
  type OrcaRouterCredential,
} from "./credential-sources.js";
import { ORCAROUTER_INFERENCE_BASE_URL } from "./constants.js";

const FAKE_KEY = "sk-orca-fake-credential-source-0001";
const FAKE_CODE = "orca-code-source-test";

let calls: string[] = [];

function stubFetch(status: number, payload: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(payload),
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

describe("describeCredentialSources / credentialSource", () => {
  it("exposes exactly the two choices, independently usable", () => {
    const sources = describeCredentialSources();
    expect(sources.map((s) => s.id)).toEqual(["orcarouter", "orcarouter-oauth"]);
    expect(sources.map((s) => s.method)).toEqual(["api_key", "pkce"]);
    expect(sources.map((s) => s.label)).toEqual(["OrcaRouter - API", "OrcaRouter - Auth"]);
    for (const source of sources) expect(source.description.trim().length).toBeGreaterThan(0);
  });

  it("returns a defensive copy — callers cannot mutate the registry", () => {
    describeCredentialSources().pop();
    expect(describeCredentialSources()).toHaveLength(2);
  });

  it("looks one up by id, and refuses an unknown id with the valid ones named", () => {
    expect(credentialSource("orcarouter")).toBe(apiKeyCredentialSource);
    expect(credentialSource("orcarouter-oauth")).toBe(pkceCredentialSource);
    expect(() => credentialSource("orcarouter-device")).toThrow(OrcaRouterCredentialError);
    expect(() => credentialSource("orcarouter-device")).toThrow(/orcarouter, orcarouter-oauth/);
  });
});

describe("api_key adapter", () => {
  it("returns the pasted key with the resolved inference base", async () => {
    const credential = await apiKeyCredentialSource.acquire({ apiKey: `  ${FAKE_KEY}  ` });
    expect(credential).toEqual({ apiKey: FAKE_KEY, baseUrl: ORCAROUTER_INFERENCE_BASE_URL });
  });

  it("does NOT spend an inference request to prove the key", async () => {
    stubFetch(200, { data: [] });
    await apiKeyCredentialSource.acquire({ apiKey: FAKE_KEY });
    expect(calls).toEqual([]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("validates shape only", async () => {
    await expect(apiKeyCredentialSource.acquire({ apiKey: "sk-openai-abc" })).rejects.toMatchObject({ reason: "shape" });
    await expect(apiKeyCredentialSource.acquire({ apiKey: "sk-orca-" })).rejects.toMatchObject({ reason: "shape" });
    await expect(apiKeyCredentialSource.acquire({ apiKey: "" })).rejects.toThrow(/required/);
    await expect(apiKeyCredentialSource.acquire({ apiKey: `sk-orca-${"x".repeat(600)}` })).rejects.toMatchObject({
      reason: "shape",
    });
  });

  it("accepts a well-formed shape and rejects an obvious typo", () => {
    expect(isWellFormedOrcaRouterKey(FAKE_KEY)).toBe(true);
    expect(isWellFormedOrcaRouterKey("sk-orca-short")).toBe(false);
    expect(isWellFormedOrcaRouterKey(undefined)).toBe(false);
  });
});

describe("pkce adapter", () => {
  it("exchanges the code and returns the issued key with the SAME shape", async () => {
    stubFetch(200, { key: FAKE_KEY, scope: "api", user_id: "u1" });
    const credential = await pkceCredentialSource.acquire({ code: FAKE_CODE, verifier: "verifier-value" });
    expect(credential).toEqual({ apiKey: FAKE_KEY, baseUrl: ORCAROUTER_INFERENCE_BASE_URL });
    expect(calls[0]).toBe("https://www.orcarouter.ai/api/v1/auth/keys");
  });

  it("requires both the code and the stored verifier", async () => {
    await expect(pkceCredentialSource.acquire({ verifier: "v" })).rejects.toMatchObject({ reason: "exchange" });
    await expect(pkceCredentialSource.acquire({ code: FAKE_CODE })).rejects.toMatchObject({ reason: "exchange" });
  });

  it("propagates a terminal exchange failure rather than inventing a credential", async () => {
    stubFetch(403, { error: "invalid_grant" });
    await expect(pkceCredentialSource.acquire({ code: FAKE_CODE, verifier: "v" })).rejects.toThrow(/expired/);
  });
});

describe("both adapters are interchangeable downstream", () => {
  it("returns a deep-equal credential object for the same key", async () => {
    stubFetch(200, { key: FAKE_KEY, scope: "api" });
    const viaKey = await apiKeyCredentialSource.acquire({ apiKey: FAKE_KEY });
    const viaPkce = await pkceCredentialSource.acquire({ code: FAKE_CODE, verifier: "v" });
    expect(viaKey).toEqual(viaPkce);
  });

  it("returns the same baseUrl under an explicit api base", async () => {
    stubFetch(200, { key: FAKE_KEY, scope: "api" });
    const apiBase = "https://api.internal.example/v1";
    const viaKey = await apiKeyCredentialSource.acquire({ apiKey: FAKE_KEY, apiBase });
    const viaPkce = await pkceCredentialSource.acquire({ code: FAKE_CODE, verifier: "v", apiBase });
    expect(viaKey.baseUrl).toBe(apiBase);
    expect(viaPkce.baseUrl).toBe(apiBase);
  });

  it("a downstream consumer of OrcaRouterCredential cannot tell which source ran", async () => {
    stubFetch(200, { key: FAKE_KEY, scope: "api" });
    // Stand-ins for the two downstream consumers (dispatch + catalog). Neither
    // receives a source id, so neither can branch on one.
    const dispatch = (credential: OrcaRouterCredential) => ({
      baseUrl: credential.baseUrl,
      header: `Bearer ${credential.apiKey}`,
    });
    const catalogRequest = (credential: OrcaRouterCredential) => `${credential.baseUrl}/models`;

    const fromKey = dispatch(await apiKeyCredentialSource.acquire({ apiKey: FAKE_KEY }));
    const fromPkce = dispatch(await pkceCredentialSource.acquire({ code: FAKE_CODE, verifier: "v" }));
    expect(fromKey).toEqual(fromPkce);
    expect(catalogRequest({ apiKey: FAKE_KEY, baseUrl: ORCAROUTER_INFERENCE_BASE_URL })).toBe(
      "https://api.orcarouter.ai/v1/models",
    );
  });
});
