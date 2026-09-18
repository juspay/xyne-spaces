import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Only the database and the connector-credential loader are mocked, so these
 * exercise the real network path — safeFetch, redirects, header construction,
 * the cross-origin strip — and the real credential resolution over it.
 */
process.env["ENCRYPTION_KEY"] ||= "00".repeat(32);

const KEY = Buffer.alloc(32, 3);

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  loadEffectiveCredentials: vi.fn(),
  hostCredRow: vi.fn(),
}));

vi.mock("../config.js", () => ({ CONFIG: { encryptionKey: Buffer.alloc(32, 3) } }));
vi.mock("../db.js", () => ({
  prisma: {
    mcpServer: { findUnique: mocks.findUnique },
    userHostCredential: { findUnique: mocks.hostCredRow, update: async () => null },
  },
}));
vi.mock("./credentials-loader.js", () => ({
  loadEffectiveCredentials: mocks.loadEffectiveCredentials,
}));
vi.mock("./host-oauth.js", () => ({
  refreshHostOAuthToken: async () => null,
  revokeHostOAuthToken: async () => true,
  revocationDetailsFor: async () => null,
}));
vi.mock("../redis.js", () => ({
  redisService: { getConnection: () => ({ set: async () => "OK" }) },
}));

const { authenticatedFetch } = await import("./host-credentials.js");
const { encrypt } = await import("../crypto.js");

/** A stored row for `host`, in the same envelope the app writes. */
function storedCredential(
  host: string,
  scheme: string,
  headerName: string | null,
  secret: string,
): Record<string, unknown> {
  const enc = encrypt(JSON.stringify({ credential: secret }), KEY);
  return {
    id: `row-${host}`, userId: "u1", host, scheme, headerName,
    encryptedCred: enc.ciphertext, iv: enc.iv, authTag: enc.authTag,
    agentSlugs: [], label: null, expiresAt: null, lastUsedAt: null, createdAt: new Date(),
  };
}

interface EchoBody {
  path: string;
  host: string;
  authorization: string | null;
  xInternal: string | null;
}

describe("authenticatedFetch", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const path = req.url ?? "/";

      if (path === "/redirect-cross-origin") {
        res.writeHead(302, { location: `http://elsewhere.example.com:${port}/echo` });
        res.end();
        return;
      }
      if (path === "/redirect-same-origin") {
        res.writeHead(302, { location: "/echo" });
        res.end();
        return;
      }
      if (path === "/public-but-token-blocked") {
        // Mirrors the production GitHub case: a valid-but-restricted token is
        // refused where an anonymous request succeeds.
        if (req.headers.authorization) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ message: "Resource protected by organization SAML enforcement" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ stargazers_count: 205 }));
        return;
      }
      if (path === "/forbidden-either-way") {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "Must have admin rights" }));
        return;
      }
      if (path === "/needs-auth") {
        if (!req.headers.authorization) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ message: "Requires authentication" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ stargazers: ["alice", "bob"] }));
        return;
      }

      const single = (value: string | string[] | undefined): string | null =>
        Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          path,
          host: req.headers.host ?? "",
          authorization: single(req.headers.authorization),
          xInternal: single(req.headers["x-internal-key"]),
        } satisfies EchoBody),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    mocks.findUnique.mockReset();
    mocks.loadEffectiveCredentials.mockReset();
    // Default: no per-host credential, so the connector map is exercised.
    mocks.hostCredRow.mockReset().mockResolvedValue(null);
  });

  // Every request keeps its real hostname (so the host→connector map applies)
  // while dialling the local test server, exactly as safe-fetch's own tests do.
  const localOpts = {
    allowLoopbackInDev: true,
    lookup: async () => [{ address: "127.0.0.1", family: 4 }],
  } as const;

  const githubServerRow = { name: "GitHub", enabled: true };

  /**
   * Resolution checks `webfetch-host:<host>` BEFORE the built-in map, so the
   * mock must answer per type — returning the GitHub row for every lookup would
   * make every host masquerade as a user-registered binding.
   */
  const mockGithubOnly = (row: { name: string; enabled: boolean } = githubServerRow) =>
    mocks.findUnique.mockImplementation(async ({ where }: { where: { type: string } }) =>
      where.type === "github" ? row : null,
    );

  it("attaches the connector credential for a mapped host", async () => {
    mockGithubOnly();
    mocks.loadEffectiveCredentials.mockResolvedValue({
      source: "user",
      connectionId: "conn_1",
      credentials: { token: "ghp_secret_value" },
      isUserOwned: true,
    });

    const { response, attached, missingConnector } = await authenticatedFetch(
      `http://api.github.com:${port}/echo`,
      { userId: "u1" },
      {},
      localOpts,
    );

    const body = (await response.json()) as EchoBody;
    expect(body.authorization).toBe("Bearer ghp_secret_value");
    expect(attached).toEqual({ serverType: "github", source: "user" });
    expect(missingConnector).toBeNull();
    // Resolution must be driven by the URL's host, not by anything else.
    expect(mocks.loadEffectiveCredentials).toHaveBeenCalledWith("u1", "github", undefined);
  });

  it("passes agentSlug through so an agent-pinned connection can win the cascade", async () => {
    mockGithubOnly();
    mocks.loadEffectiveCredentials.mockResolvedValue({
      source: "agent",
      connectionId: "conn_2",
      credentials: { token: "ghp_agent" },
      isUserOwned: false,
    });

    const { attached } = await authenticatedFetch(
      `http://api.github.com:${port}/echo`,
      { userId: "u1", agentSlug: "reviewer" },
      {},
      localOpts,
    );

    expect(mocks.loadEffectiveCredentials).toHaveBeenCalledWith("u1", "github", "reviewer");
    expect(attached?.source).toBe("agent");
  });

  it("sends NOTHING for an unmapped host — no lookup, no credential", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const { response, attached, missingConnector } = await authenticatedFetch(
      `http://unmapped.example.com:${port}/echo`,
      { userId: "u1" },
      {},
      localOpts,
    );

    const body = (await response.json()) as EchoBody;
    expect(body.authorization).toBeNull();
    expect(attached).toBeNull();
    expect(missingConnector).toBeNull();
    expect(mocks.loadEffectiveCredentials).not.toHaveBeenCalled();
  });

  it("reports the missing connector when the host is known but not connected", async () => {
    mockGithubOnly();
    mocks.loadEffectiveCredentials.mockResolvedValue(null);

    const { response, attached, missingConnector } = await authenticatedFetch(
      `http://api.github.com:${port}/needs-auth`,
      { userId: "u1" },
      {},
      localOpts,
    );

    expect(response.status).toBe(401);
    expect(attached).toBeNull();
    expect(missingConnector).toEqual({ serverType: "github", label: "GitHub" });
  });

  it("turns a 401 into a 200 once the credential exists — the incident, end to end", async () => {
    mockGithubOnly();

    mocks.loadEffectiveCredentials.mockResolvedValue(null);
    const before = await authenticatedFetch(
      `http://api.github.com:${port}/needs-auth`,
      { userId: "u1" },
      {},
      localOpts,
    );
    expect(before.response.status).toBe(401);

    mocks.loadEffectiveCredentials.mockResolvedValue({
      source: "user",
      connectionId: "conn_1",
      credentials: { token: "ghp_now_connected" },
      isUserOwned: true,
    });
    const after = await authenticatedFetch(
      `http://api.github.com:${port}/needs-auth`,
      { userId: "u1" },
      {},
      localOpts,
    );
    expect(after.response.status).toBe(200);
    expect((await after.response.json()) as unknown).toEqual({ stargazers: ["alice", "bob"] });
  });

  it("accepts an OAuth-shaped credential (accessToken) as well as a PAT", async () => {
    mockGithubOnly();
    mocks.loadEffectiveCredentials.mockResolvedValue({
      source: "user",
      connectionId: "c",
      credentials: { accessToken: "oauth_access" },
      isUserOwned: true,
    });

    const { response } = await authenticatedFetch(
      `http://api.github.com:${port}/echo`,
      { userId: "u1" },
      {},
      localOpts,
    );
    expect(((await response.json()) as EchoBody).authorization).toBe("Bearer oauth_access");
  });

  it("treats an unusable credential shape as not-connected rather than sending a malformed header", async () => {
    mockGithubOnly();
    mocks.loadEffectiveCredentials.mockResolvedValue({
      source: "user",
      connectionId: "c",
      credentials: { username: "someone" },
      isUserOwned: true,
    });

    const { response, attached, missingConnector } = await authenticatedFetch(
      `http://api.github.com:${port}/echo`,
      { userId: "u1" },
      {},
      localOpts,
    );

    expect(((await response.json()) as EchoBody).authorization).toBeNull();
    expect(attached).toBeNull();
    expect(missingConnector?.serverType).toBe("github");
  });

  it("lets a user's own host credential WIN over the built-in connector map", async () => {
    // github.com fronts two auth systems: api.github.com takes a PAT, the web
    // UI takes a session cookie. The hand-bound credential must not be shadowed
    // by the built-in github entry, or the cookie silently never gets sent.
    mockGithubOnly();
    mocks.hostCredRow.mockResolvedValue(
      storedCredential("github.com", "cookie", null, "user_session=abc"),
    );

    const { response, attached } = await authenticatedFetch(
      `http://github.com:${port}/echo`,
      { userId: "u1" },
      {},
      localOpts,
    );

    expect(attached?.serverType).toBe("webfetch-host:github.com");
    // The PAT's Authorization header must NOT be what went out.
    expect(((await response.json()) as EchoBody).authorization).toBeNull();
    expect(mocks.loadEffectiveCredentials).not.toHaveBeenCalled();
  });

  it("sends a host credential under its chosen custom header", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.hostCredRow.mockResolvedValue(
      storedCredential("internal.example.com", "header", "X-Internal-Key", "k-123"),
    );

    const { response, attached } = await authenticatedFetch(
      `http://internal.example.com:${port}/echo`,
      { userId: "u1" },
      {},
      localOpts,
    );

    const body = (await response.json()) as EchoBody;
    expect(body.xInternal).toBe("k-123");
    expect(body.authorization).toBeNull();
    expect(attached?.serverType).toBe("webfetch-host:internal.example.com");
  });

  it("stays anonymous when the connector row is disabled", async () => {
    mockGithubOnly({ name: "GitHub", enabled: false });

    const { response, attached, missingConnector } = await authenticatedFetch(
      `http://api.github.com:${port}/echo`,
      { userId: "u1" },
      {},
      localOpts,
    );

    expect(((await response.json()) as EchoBody).authorization).toBeNull();
    expect(attached).toBeNull();
    expect(missingConnector).toBeNull();
  });

  it("stays anonymous when there is no userId", async () => {
    const { response, attached } = await authenticatedFetch(
      `http://api.github.com:${port}/echo`,
      {},
      {},
      localOpts,
    );
    expect(((await response.json()) as EchoBody).authorization).toBeNull();
    expect(attached).toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  describe("anonymous fallback when the credential is worse than none", () => {
    const withToken = () => {
      mockGithubOnly();
      mocks.loadEffectiveCredentials.mockResolvedValue({
        source: "user",
        connectionId: "c",
        credentials: { token: "ghp_restricted" },
        isUserOwned: true,
      });
    };

    it("prefers the anonymous result when the credential is refused but anonymous works", async () => {
      withToken();
      const { response, attached, credentialRejected, anonymousFallbackUsed } = await authenticatedFetch(
        `http://api.github.com:${port}/public-but-token-blocked`,
        { userId: "u1" },
        {},
        localOpts,
      );

      // The regression this fixes: before the fallback this returned 403.
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ stargazers_count: 205 });
      expect(anonymousFallbackUsed).toBe(true);
      expect(credentialRejected).toEqual({ serverType: "github", source: "user" });
      expect(attached).toBeNull();
    });

    it("keeps the credentialed response when anonymous fails too", async () => {
      withToken();
      const { response, attached, credentialRejected, anonymousFallbackUsed } = await authenticatedFetch(
        `http://api.github.com:${port}/forbidden-either-way`,
        { userId: "u1" },
        {},
        localOpts,
      );

      expect(response.status).toBe(403);
      // The body must survive — it is the only place the reason appears.
      expect(await response.json()).toEqual({ message: "Must have admin rights" });
      expect(anonymousFallbackUsed).toBe(false);
      expect(credentialRejected).toEqual({ serverType: "github", source: "user" });
      expect(attached).toEqual({ serverType: "github", source: "user" });
    });

    it("does not retry on a non-auth failure", async () => {
      withToken();
      const { response, credentialRejected, anonymousFallbackUsed } = await authenticatedFetch(
        `http://api.github.com:${port}/missing`,
        { userId: "u1" },
        {},
        localOpts,
      );
      expect(response.status).toBe(200); // the echo catch-all
      expect(credentialRejected).toBeNull();
      expect(anonymousFallbackUsed).toBe(false);
    });
  });

  describe("security invariants", () => {
    it("drops Authorization on a cross-origin redirect", async () => {
      mockGithubOnly();
      mocks.loadEffectiveCredentials.mockResolvedValue({
        source: "user",
        connectionId: "c",
        credentials: { token: "ghp_must_not_leak" },
        isUserOwned: true,
      });

      const { response } = await authenticatedFetch(
        `http://api.github.com:${port}/redirect-cross-origin`,
        { userId: "u1" },
        {},
        localOpts,
      );

      const body = (await response.json()) as EchoBody;
      expect(body.host).toBe(`elsewhere.example.com:${port}`);
      expect(body.authorization).toBeNull();
    });

    it("keeps Authorization on a same-origin redirect", async () => {
      mockGithubOnly();
      mocks.loadEffectiveCredentials.mockResolvedValue({
        source: "user",
        connectionId: "c",
        credentials: { token: "ghp_same_origin" },
        isUserOwned: true,
      });

      const { response } = await authenticatedFetch(
        `http://api.github.com:${port}/redirect-same-origin`,
        { userId: "u1" },
        {},
        localOpts,
      );

      expect(((await response.json()) as EchoBody).authorization).toBe("Bearer ghp_same_origin");
    });

    it("never resolves a credential for a lookalike host", async () => {
      // The map is exact-match; a suffix/substring match would hand a GitHub
      // token to an attacker-controlled name that merely contains it.
      mocks.findUnique.mockResolvedValue(null);

      for (const host of [
        "api.github.com.attacker.example.com",
        "evil-api.github.com.example.com",
        "notgithub.com",
      ]) {
        const { attached, response } = await authenticatedFetch(
          `http://${host}:${port}/echo`,
          { userId: "u1" },
          {},
          localOpts,
        );
        expect(attached, host).toBeNull();
        expect(((await response.json()) as EchoBody).authorization, host).toBeNull();
      }
      // A lookalike must never reach the connector map at all.
      expect(mocks.findUnique).not.toHaveBeenCalled();
    });

    it("refuses any method other than GET/HEAD", async () => {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        await expect(
          authenticatedFetch(`http://api.github.com:${port}/echo`, { userId: "u1" }, { method }, localOpts),
        ).rejects.toThrow(/GET and HEAD only/);
      }
      expect(mocks.loadEffectiveCredentials).not.toHaveBeenCalled();
    });

    it("still refuses a private address even for a mapped host", async () => {
      mockGithubOnly();
      mocks.loadEffectiveCredentials.mockResolvedValue({
        source: "user",
        connectionId: "c",
        credentials: { token: "ghp_x" },
        isUserOwned: true,
      });

      // A binding must never become a way past the SSRF deny list.
      await expect(
        authenticatedFetch(
          `http://api.github.com:${port}/echo`,
          { userId: "u1" },
          {},
          { lookup: async () => [{ address: "169.254.169.254", family: 4 }] },
        ),
      ).rejects.toThrow(/Blocked destination address/);
    });
  });
});
