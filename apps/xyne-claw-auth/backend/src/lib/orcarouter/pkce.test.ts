import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

const logs: string[] = [];

vi.mock("../../logger.js", () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
    warn: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
    error: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
    debug: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
  }),
}));

import {
  buildAuthorizeUrl,
  createPkceAttempt,
  exchangeCode,
  OrcaRouterExchangeError,
} from "./pkce.js";
import { ORCAROUTER_AUTHORIZE_PATH, ORCAROUTER_EXCHANGE_PATH } from "./constants.js";
import { assertNoOrcaRouterSecret } from "./redact.js";

const AUTH_ORIGIN = "https://www.orcarouter.ai";
const API_ORIGIN = "https://api.orcarouter.ai";
const FAKE_CODE = "orca-code-abc123";

interface Captured {
  url: string;
  method?: string | undefined;
  headers: Record<string, string>;
  body: string;
}

let captured: Captured[] = [];

function stubFetch(status: number, payload: unknown, opts: { raw?: string } = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      captured.push({
        url,
        method: init?.method,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === "string" ? init.body : "",
      });
      const text = opts.raw ?? JSON.stringify(payload);
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => text,
        json: async () => JSON.parse(text),
      } as unknown as Response;
    }),
  );
}

function stubFetchThrows(message: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error(message);
    }),
  );
}

beforeEach(() => {
  captured = [];
  logs.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPkceAttempt", () => {
  it("mints a fresh verifier and state per attempt, from a crypto RNG", () => {
    const first = createPkceAttempt();
    const second = createPkceAttempt();

    expect(first.verifier).not.toBe(second.verifier);
    expect(first.state).not.toBe(second.state);
    expect(first.challenge).not.toBe(second.challenge);

    expect(Buffer.from(first.verifier, "base64url")).toHaveLength(32);
    expect(Buffer.from(first.state, "base64url")).toHaveLength(16);
  });

  it("challenge is the UNPADDED base64url of sha256(verifier)", () => {
    const attempt = createPkceAttempt();
    const expected = crypto
      .createHash("sha256")
      .update(attempt.verifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(attempt.challenge).toBe(expected);
    expect(attempt.challenge).not.toContain("=");
    expect(attempt.challenge).not.toContain("+");
    expect(attempt.challenge).not.toContain("/");
  });

  it("a hundred attempts never collide on verifier or state", () => {
    const verifiers = new Set<string>();
    const states = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const attempt = createPkceAttempt();
      verifiers.add(attempt.verifier);
      states.add(attempt.state);
    }
    expect(verifiers.size).toBe(100);
    expect(states.size).toBe(100);
  });
});

describe("buildAuthorizeUrl (Flow B, out-of-band code)", () => {
  it("targets the auth origin at /auth with callback_url=oob and S256", () => {
    const attempt = createPkceAttempt();
    const url = new URL(buildAuthorizeUrl({ challenge: attempt.challenge, state: attempt.state }));

    expect(url.origin).toBe(AUTH_ORIGIN);
    expect(url.pathname).toBe(ORCAROUTER_AUTHORIZE_PATH);
    expect(url.searchParams.get("callback_url")).toBe("oob");
    expect(url.searchParams.get("code_challenge")).toBe(attempt.challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(attempt.state);
    expect(url.searchParams.get("app_name")).toBe("Xyne Spaces");
    expect(url.searchParams.get("scope")).toBe("api");
  });

  it("never carries the verifier — only its challenge", () => {
    const attempt = createPkceAttempt();
    const url = buildAuthorizeUrl({ challenge: attempt.challenge, state: attempt.state });
    expect(url).not.toContain(attempt.verifier);
    expect(url).not.toContain("code_verifier");
  });

  it("uses an explicit auth base when one is given, and never the api origin", () => {
    const attempt = createPkceAttempt();
    const url = new URL(
      buildAuthorizeUrl({
        authBase: "https://auth.internal.example",
        challenge: attempt.challenge,
        state: attempt.state,
      }),
    );
    expect(url.origin).toBe("https://auth.internal.example");
    expect(url.href).not.toContain(API_ORIGIN);
  });

  it("honours a caller-supplied app name and scope", () => {
    const attempt = createPkceAttempt();
    const url = new URL(
      buildAuthorizeUrl({
        challenge: attempt.challenge,
        state: attempt.state,
        appName: "My Tool",
        scope: "api",
      }),
    );
    expect(url.searchParams.get("app_name")).toBe("My Tool");
  });

  it("refuses a remote http auth origin, allows loopback http", () => {
    const attempt = createPkceAttempt();
    expect(() =>
      buildAuthorizeUrl({ authBase: "http://auth.example.com", challenge: attempt.challenge, state: attempt.state }),
    ).toThrow(/https/);
    expect(() =>
      buildAuthorizeUrl({ authBase: "http://127.0.0.1:8787", challenge: attempt.challenge, state: attempt.state }),
    ).not.toThrow();
  });
});

describe("exchangeCode", () => {
  it("POSTs to the auth origin's /api/v1/auth/keys with the verifier in the BODY only", async () => {
    stubFetch(200, { key: "sk-orca-fake-body-0001", user_id: "12345", scope: "api" });
    const attempt = createPkceAttempt();

    const result = await exchangeCode({ code: FAKE_CODE, verifier: attempt.verifier });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${AUTH_ORIGIN}${ORCAROUTER_EXCHANGE_PATH}`);
    expect(captured[0]?.method).toBe("POST");
    expect(captured[0]?.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(captured[0]!.body)).toEqual({
      code: FAKE_CODE,
      code_verifier: attempt.verifier,
      code_challenge_method: "S256",
    });
    expect(result).toEqual({ apiKey: "sk-orca-fake-body-0001", scope: "api", userId: "12345" });
  });

  it("never builds the 404 — the exchange host is the auth origin, not the api origin", async () => {
    stubFetch(200, { key: "sk-orca-fake-body-0002", scope: "api" });
    const attempt = createPkceAttempt();
    await exchangeCode({ code: FAKE_CODE, verifier: attempt.verifier });

    const called = captured[0]!.url;
    expect(called).not.toContain(API_ORIGIN);
    expect(called).toContain(`${AUTH_ORIGIN}/api/v1/auth/keys`);
    expect(called).not.toContain(`${API_ORIGIN}/v1/auth`);
  });

  it("follows an explicit auth base for the exchange", async () => {
    stubFetch(200, { key: "sk-orca-fake-body-0003", scope: "api" });
    const attempt = createPkceAttempt();
    await exchangeCode({
      authBase: "https://auth.internal.example",
      code: FAKE_CODE,
      verifier: attempt.verifier,
    });
    expect(captured[0]?.url).toBe(`https://auth.internal.example${ORCAROUTER_EXCHANGE_PATH}`);
  });

  it("rejects a granted scope that is not api instead of assuming it", async () => {
    stubFetch(200, { key: "sk-orca-fake-body-0004", scope: "connector" });
    const attempt = createPkceAttempt();

    await expect(exchangeCode({ code: FAKE_CODE, verifier: attempt.verifier })).rejects.toMatchObject({
      reason: "scope",
    });
    await expect(exchangeCode({ code: FAKE_CODE, verifier: attempt.verifier })).rejects.toThrow(/connector/);
  });

  it("rejects a success body with no key at all", async () => {
    stubFetch(200, { scope: "api" });
    const attempt = createPkceAttempt();
    await expect(exchangeCode({ code: FAKE_CODE, verifier: attempt.verifier })).rejects.toMatchObject({
      reason: "malformed",
    });
  });

  it("rejects a key that is not an sk-orca- value", async () => {
    stubFetch(200, { key: "not-a-key", scope: "api" });
    const attempt = createPkceAttempt();
    await expect(exchangeCode({ code: FAKE_CODE, verifier: attempt.verifier })).rejects.toMatchObject({
      reason: "malformed",
    });
  });

  it("classifies a denial as denied", async () => {
    stubFetch(400, { error: "access_denied", error_description: "The user denied the request" });
    const attempt = createPkceAttempt();
    await expect(exchangeCode({ code: FAKE_CODE, verifier: attempt.verifier })).rejects.toMatchObject({
      reason: "denied",
    });
  });

  it("classifies an expired / reused code (403) as expired_or_reused", async () => {
    stubFetch(403, { error: "invalid_grant", error_description: "code expired" });
    const attempt = createPkceAttempt();
    await expect(exchangeCode({ code: FAKE_CODE, verifier: attempt.verifier })).rejects.toMatchObject({
      status: 403,
      reason: "expired_or_reused",
    });
  });

  it("classifies a 400 (bad challenge method / downgrade) as bad_request", async () => {
    stubFetch(400, { error: "invalid_request", error_description: "code_challenge_method mismatch" });
    const attempt = createPkceAttempt();
    await expect(exchangeCode({ code: FAKE_CODE, verifier: attempt.verifier })).rejects.toMatchObject({
      status: 400,
      reason: "bad_request",
    });
  });

  it("classifies a 429 as rate_limited and says so actionably", async () => {
    stubFetch(429, { error: "rate_limited" });
    const attempt = createPkceAttempt();
    await expect(exchangeCode({ code: FAKE_CODE, verifier: attempt.verifier })).rejects.toMatchObject({
      status: 429,
      reason: "rate_limited",
    });
  });

  it("classifies a transport failure as network and does not hot-loop", async () => {
    stubFetchThrows("fetch failed");
    const attempt = createPkceAttempt();
    await expect(exchangeCode({ code: FAKE_CODE, verifier: attempt.verifier })).rejects.toMatchObject({
      reason: "network",
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty code or a missing verifier without calling out", async () => {
    stubFetch(200, { key: "sk-orca-fake-body-0005", scope: "api" });
    const attempt = createPkceAttempt();
    await expect(exchangeCode({ code: "   ", verifier: attempt.verifier })).rejects.toBeInstanceOf(
      OrcaRouterExchangeError,
    );
    await expect(exchangeCode({ code: FAKE_CODE, verifier: "" })).rejects.toMatchObject({
      reason: "expired_or_reused",
    });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("a junk (non-JSON) error body still ends safely", async () => {
    stubFetch(502, null, { raw: "<html>bad gateway</html>" });
    const attempt = createPkceAttempt();
    await expect(exchangeCode({ code: FAKE_CODE, verifier: attempt.verifier })).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe("secrets never escape", () => {
  it("no error message or log line carries the verifier or the key", async () => {
    const attempt = createPkceAttempt();
    const secrets = [attempt.verifier, attempt.challenge, "sk-orca-fake-body-0006"];

    stubFetch(403, { error: "invalid_grant", error_description: "code expired" });
    const failure = await exchangeCode({ code: FAKE_CODE, verifier: attempt.verifier }).catch((e: unknown) => e);
    const rendered = `${String(failure)} ${JSON.stringify(failure)}`;
    expect(assertNoOrcaRouterSecret(rendered, secrets).containsNoSecret).toBe(true);

    stubFetch(200, { key: "sk-orca-fake-body-0006", scope: "api" });
    await exchangeCode({ code: FAKE_CODE, verifier: attempt.verifier });

    expect(logs.join("\n")).not.toContain(attempt.verifier);
    expect(logs.join("\n")).not.toContain("sk-orca-fake-body-0006");
  });

  it("the success payload never contains the verifier", async () => {
    stubFetch(200, { key: "sk-orca-fake-body-0007", scope: "api", user_id: "u1" });
    const attempt = createPkceAttempt();
    const result = await exchangeCode({ code: FAKE_CODE, verifier: attempt.verifier });
    expect(JSON.stringify(result)).not.toContain(attempt.verifier);
  });
});
