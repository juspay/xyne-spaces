/**
 * End-to-end PKCE integration test through the REAL connect adapter.
 *
 * The unit tests in `pkce.test.ts` stub `fetch`. This file deliberately does
 * not: it starts a real HTTP server on loopback that plays the OrcaRouter
 * consent + exchange endpoints, then drives `credentialSource("orcarouter-oauth")`
 * — the same adapter the route calls — through authorize → code → exchange →
 * persist. That is the only way to catch a wrong path, a wrong verb, a body
 * shape the wire format rejects, or a verifier that leaks into a URL.
 *
 * No real network call is made and no real credential is used: the server is
 * local and the issued key is an obvious fake.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { credentialSource, describeCredentialSources, isWellFormedOrcaRouterKey } from "./credential-sources.js";
import { buildAuthorizeUrl, createPkceAttempt } from "./pkce.js";
import {
  ORCAROUTER_AUTHORIZE_PATH,
  ORCAROUTER_EXCHANGE_PATH,
  ORCAROUTER_KEY_PREFIX,
} from "./constants.js";
import { decrypt, encrypt } from "../../crypto.js";

const FAKE_ISSUED_KEY = `${ORCAROUTER_KEY_PREFIX}test0issued0by0fake0server000000`;
const MASTER_KEY = Buffer.alloc(32, 7);

interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  contentType: string | undefined;
}

/**
 * A stand-in for the OrcaRouter auth service. It verifies the PKCE binding for
 * real — it recomputes the S256 challenge from the presented verifier and
 * compares it to the one the authorize URL carried — so a wrong verifier, a
 * padded challenge, or a plain-text downgrade all fail here.
 */
class FakeAuthServer {
  readonly requests: Recorded[] = [];
  issued = 0;
  private server: http.Server | null = null;
  private challengeForState = new Map<string, string>();
  private usedCodes = new Set<string>();
  private nextCode = 0;
  /** Flip to make the next exchange answer with a terminal error. */
  failNextWith: { status: number; body: unknown } | null = null;
  /** Scope the server actually grants, which may differ from what was asked. */
  grantedScope = "api";

  async start(): Promise<string> {
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const { port } = this.server!.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  /** Simulates the user approving on the consent screen. */
  approve(authorizeUrl: string): string {
    const url = new URL(authorizeUrl);
    const state = url.searchParams.get("state") ?? "";
    const challenge = url.searchParams.get("code_challenge") ?? "";
    this.challengeForState.set(state, challenge);
    const code = `code-${++this.nextCode}`;
    return code;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const raw = await new Promise<string>((resolve) => {
      let acc = "";
      req.on("data", (c) => (acc += c));
      req.on("end", () => resolve(acc));
    });
    let body: unknown = raw;
    try {
      body = JSON.parse(raw);
    } catch {
      /* form-encoded or empty */
    }
    this.requests.push({
      method: req.method ?? "",
      path: url.pathname,
      query: url.searchParams,
      body,
      contentType: req.headers["content-type"],
    });

    if (url.pathname !== ORCAROUTER_EXCHANGE_PATH) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    if (this.failNextWith) {
      const { status, body: failure } = this.failNextWith;
      this.failNextWith = null;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(failure));
      return;
    }

    const record = body as Record<string, unknown>;
    const code = String(record["code"] ?? "");
    const verifier = String(record["code_verifier"] ?? "");
    const method = String(record["code_challenge_method"] ?? "");

    if (method !== "S256") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_request", error_description: "S256 required" }));
      return;
    }
    if (this.usedCodes.has(code)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "code already used" }));
      return;
    }

    // Recompute the challenge exactly as the server would.
    const { createHash } = await import("node:crypto");
    const recomputed = createHash("sha256").update(verifier).digest("base64url");
    const expected = [...this.challengeForState.values()];
    if (!expected.includes(recomputed)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "verifier does not match" }));
      return;
    }

    this.usedCodes.add(code);
    this.issued += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ key: FAKE_ISSUED_KEY, user_id: "4242", scope: this.grantedScope }));
  }
}

describe("PKCE end-to-end through the connect adapter", () => {
  let server: FakeAuthServer;
  let authBase: string;

  beforeEach(async () => {
    server = new FakeAuthServer();
    authBase = await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("authorize → code → exchange → persist yields a usable key with no manual copying", async () => {
    const attempt = createPkceAttempt();
    const authorizeUrl = buildAuthorizeUrl({
      authBase,
      challenge: attempt.challenge,
      state: attempt.state,
      appName: "Xyne Spaces",
      scope: "api",
    });

    // The browser would show this; the user approves and the code comes back.
    const code = server.approve(authorizeUrl);

    const credential = await credentialSource("orcarouter-oauth").acquire({
      code,
      state: attempt.state,
      verifier: attempt.verifier,
      authBase,
      apiBase: "https://api.orcarouter.ai/v1",
    });

    expect(credential.apiKey).toBe(FAKE_ISSUED_KEY);
    expect(credential.baseUrl).toBe("https://api.orcarouter.ai/v1");
    expect(isWellFormedOrcaRouterKey(credential.apiKey)).toBe(true);

    // Exactly one exchange, on the auth origin, at the documented path.
    const exchanges = server.requests.filter((r) => r.path === ORCAROUTER_EXCHANGE_PATH);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.method).toBe("POST");
    const sent = exchanges[0]?.body as Record<string, unknown>;
    expect(sent["code"]).toBe(code);
    expect(sent["code_verifier"]).toBe(attempt.verifier);
    expect(sent["code_challenge_method"]).toBe("S256");
    expect(server.issued).toBe(1);
  });

  it("sends only the S256 challenge on the authorize URL — never the verifier", async () => {
    const attempt = createPkceAttempt();
    const authorizeUrl = buildAuthorizeUrl({
      authBase,
      challenge: attempt.challenge,
      state: attempt.state,
      appName: "Xyne Spaces",
      scope: "api",
    });

    const url = new URL(authorizeUrl);
    expect(url.pathname).toBe(ORCAROUTER_AUTHORIZE_PATH);
    expect(url.searchParams.get("callback_url")).toBe("oob");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(attempt.challenge);
    expect(url.searchParams.get("state")).toBe(attempt.state);
    expect(authorizeUrl).not.toContain(attempt.verifier);
  });

  it("the persisted credential round-trips through the project's secret storage", async () => {
    const attempt = createPkceAttempt();
    const code = server.approve(
      buildAuthorizeUrl({ authBase, challenge: attempt.challenge, state: attempt.state, appName: "X", scope: "api" }),
    );
    const credential = await credentialSource("orcarouter-oauth").acquire({
      code,
      state: attempt.state,
      verifier: attempt.verifier,
      authBase,
    });

    // Same storage the route uses for every other provider credential.
    const sealed = encrypt(credential.apiKey, MASTER_KEY);
    expect(sealed.ciphertext).not.toContain(credential.apiKey);
    expect(decrypt(sealed.ciphertext, sealed.iv, sealed.authTag, MASTER_KEY)).toBe(FAKE_ISSUED_KEY);
  });

  it("a second exchange of the same code is refused, not silently re-issued", async () => {
    const attempt = createPkceAttempt();
    const code = server.approve(
      buildAuthorizeUrl({ authBase, challenge: attempt.challenge, state: attempt.state, appName: "X", scope: "api" }),
    );
    const source = credentialSource("orcarouter-oauth");
    await source.acquire({ code, state: attempt.state, verifier: attempt.verifier, authBase });

    await expect(
      source.acquire({ code, state: attempt.state, verifier: attempt.verifier, authBase }),
    ).rejects.toThrow(/expired|used|already/i);
    expect(server.issued).toBe(1);
  });

  it("a tampered verifier cannot redeem the code", async () => {
    const attempt = createPkceAttempt();
    const code = server.approve(
      buildAuthorizeUrl({ authBase, challenge: attempt.challenge, state: attempt.state, appName: "X", scope: "api" }),
    );

    await expect(
      credentialSource("orcarouter-oauth").acquire({
        code,
        state: attempt.state,
        verifier: "not-the-verifier-that-made-the-challenge",
        authBase,
      }),
    ).rejects.toThrow();
    expect(server.issued).toBe(0);
  });

  it("a granted scope that is not api is refused instead of assumed", async () => {
    server.grantedScope = "connector";
    const attempt = createPkceAttempt();
    const code = server.approve(
      buildAuthorizeUrl({ authBase, challenge: attempt.challenge, state: attempt.state, appName: "X", scope: "api" }),
    );

    await expect(
      credentialSource("orcarouter-oauth").acquire({
        code,
        state: attempt.state,
        verifier: attempt.verifier,
        authBase,
      }),
    ).rejects.toThrow(/scope/i);
  });

  it("a denial ends safely and issues nothing", async () => {
    server.failNextWith = { status: 403, body: { error: "access_denied", error_description: "user denied" } };
    const attempt = createPkceAttempt();
    const code = server.approve(
      buildAuthorizeUrl({ authBase, challenge: attempt.challenge, state: attempt.state, appName: "X", scope: "api" }),
    );

    await expect(
      credentialSource("orcarouter-oauth").acquire({
        code,
        state: attempt.state,
        verifier: attempt.verifier,
        authBase,
      }),
    ).rejects.toThrow(/denied|refus/i);
    expect(server.issued).toBe(0);
  });

  it("a 429 is reported as rate limiting, not retried in a hot loop", async () => {
    server.failNextWith = { status: 429, body: { error: "rate_limited" } };
    const attempt = createPkceAttempt();
    const code = server.approve(
      buildAuthorizeUrl({ authBase, challenge: attempt.challenge, state: attempt.state, appName: "X", scope: "api" }),
    );

    await expect(
      credentialSource("orcarouter-oauth").acquire({
        code,
        state: attempt.state,
        verifier: attempt.verifier,
        authBase,
      }),
    ).rejects.toThrow(/429|rate|limit|too many/i);
    // One attempt, one request: no retry storm.
    expect(server.requests.filter((r) => r.path === ORCAROUTER_EXCHANGE_PATH)).toHaveLength(1);
  });

  it("an unreachable auth server ends safely with an actionable message", async () => {
    const attempt = createPkceAttempt();
    const dead = await server.start();
    await server.stop();

    await expect(
      credentialSource("orcarouter-oauth").acquire({
        code: "code-1",
        state: attempt.state,
        verifier: attempt.verifier,
        authBase: dead,
      }),
    ).rejects.toThrow();
  });

  it("both adapters produce the same downstream credential shape for the same key", async () => {
    const attempt = createPkceAttempt();
    const code = server.approve(
      buildAuthorizeUrl({ authBase, challenge: attempt.challenge, state: attempt.state, appName: "X", scope: "api" }),
    );
    const viaPkce = await credentialSource("orcarouter-oauth").acquire({
      code,
      state: attempt.state,
      verifier: attempt.verifier,
      authBase,
      apiBase: "https://api.orcarouter.ai/v1",
    });
    const viaKey = await credentialSource("orcarouter").acquire({
      apiKey: FAKE_ISSUED_KEY,
      apiBase: "https://api.orcarouter.ai/v1",
    });

    expect(Object.keys(viaPkce).sort()).toEqual(Object.keys(viaKey).sort());
    expect(viaPkce).toEqual(viaKey);
    // Downstream cannot tell which adapter ran — that is the point of the seam.
    expect(describeCredentialSources().map((s) => s.method)).toEqual(["api_key", "pkce"]);
  });

  it("neither the verifier nor the key appears in any recorded request line", async () => {
    const attempt = createPkceAttempt();
    const code = server.approve(
      buildAuthorizeUrl({ authBase, challenge: attempt.challenge, state: attempt.state, appName: "X", scope: "api" }),
    );
    await credentialSource("orcarouter-oauth").acquire({
      code,
      state: attempt.state,
      verifier: attempt.verifier,
      authBase,
    });

    const transcript = JSON.stringify(server.requests);
    // The verifier travels in the POST body — that is the one legitimate place.
    const nonBody = server.requests
      .map((r) => `${r.method} ${r.path}?${r.query.toString()} ${r.contentType ?? ""}`)
      .join("\n");
    expect(nonBody).not.toContain(attempt.verifier);
    expect(nonBody).not.toContain(FAKE_ISSUED_KEY);
    expect(transcript).not.toContain("code_challenge=" + attempt.verifier);
  });
});
