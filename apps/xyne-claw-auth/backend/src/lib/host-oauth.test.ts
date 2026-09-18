/**
 * The safety properties of discovery, and of the paste-a-token fallback.
 *
 * A Sign in button is a link we ask the user to trust, built from metadata a
 * host we know nothing about published about itself; a token-page link drops
 * someone inside their own intranet. Both are guesses that must fail closed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Set before the import, and therefore a DYNAMIC import: `import` statements
// are hoisted above assignments, so a static one would load config.ts — which
// throws on a missing key — before this line ever runs.
process.env["ENCRYPTION_KEY"] ||= "00".repeat(32);

const mocks = vi.hoisted(() => ({ safeFetch: vi.fn() }));
vi.mock("./safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }));
vi.mock("../db.js", () => ({ prisma: { hostOAuthClient: { findUnique: async () => null } } }));
vi.mock("../redis.js", () => ({ redisService: { getConnection: () => ({}) } }));

const {
  relatedHosts,
  normalizeHostname,
  sameIssuer,
  parseAuthServerMetadata,
  resourceMetadataUrlFrom,
  detectCredentialHint,
} = await import("./host-oauth.js");

const page = (headers: Record<string, string>, title = ""): Response =>
  new Response(`<html><head><title>${title}</title></head><body>hi</body></html>`, {
    status: 200,
    headers: new Headers({ "content-type": "text/html", ...headers }),
  });

/*
 * Braces matter here. `() => mocks.safeFetch.mockReset()` implicitly RETURNS
 * the mock, and vitest treats a function returned from beforeEach as a teardown
 * callback — so it invoked the mock after each test, which threw once a test
 * gave it a throwing implementation.
 */
beforeEach(() => { mocks.safeFetch.mockReset(); });

describe("relatedHosts", () => {
  it("accepts a host and its own organisation's authorization server", () => {
    expect(relatedHosts("sso.juspay.net", "bitbucket.juspay.net")).toBe(true);
    expect(relatedHosts("bitbucket.juspay.net", "bitbucket.juspay.net")).toBe(true);
    expect(relatedHosts("id.acme.co.uk", "app.acme.co.uk")).toBe(true);
  });

  it("refuses a host nominating somebody else's authorization server", () => {
    // Without this, a hostile page gets us to render a Sign in button pointing
    // at a real Google URL with parameters of its choosing.
    expect(relatedHosts("accounts.google.com", "evil.example")).toBe(false);
    expect(relatedHosts("login.microsoftonline.com", "totally-legit.com")).toBe(false);
  });

  it("treats two tenants of one platform as strangers", () => {
    expect(relatedHosts("a.vercel.app", "b.vercel.app")).toBe(false);
    expect(relatedHosts("victim.atlassian.net", "attacker.atlassian.net")).toBe(false);
    expect(relatedHosts("a-x.a.run.app", "b-y.a.run.app")).toBe(false);
    expect(relatedHosts("evil.com.pk", "victim.com.pk")).toBe(false);
    expect(relatedHosts("foo.co.uk", "bar.co.uk")).toBe(false);
  });

  it("is not fooled by a trailing dot", () => {
    expect(relatedHosts("bitbucket.juspay.net.", "bitbucket.juspay.net")).toBe(true);
    expect(normalizeHostname("Bitbucket.Juspay.NET.")).toBe("bitbucket.juspay.net");
  });
});

describe("sameIssuer", () => {
  it("ignores a trailing slash but nothing else", () => {
    expect(sameIssuer("https://as.example.com", "https://as.example.com/")).toBe(true);
    expect(sameIssuer("https://as.example.com/t", "https://as.example.com/t/")).toBe(true);
    expect(sameIssuer("https://as.example.com", "https://as.example.com/t")).toBe(false);
    expect(sameIssuer("https://as.example.com", "https://other.example.com")).toBe(false);
  });
});

describe("parseAuthServerMetadata", () => {
  const good = {
    issuer: "https://sso.juspay.net",
    authorization_endpoint: "https://sso.juspay.net/authorize",
    token_endpoint: "https://sso.juspay.net/token",
    registration_endpoint: "https://sso.juspay.net/register",
    code_challenge_methods_supported: ["S256"],
  };
  const parse = (doc: Record<string, unknown>, expected = "https://sso.juspay.net"): unknown =>
    parseAuthServerMetadata(doc, "bitbucket.juspay.net", "authorization-server", null, expected);

  it("accepts a well-formed document", () => {
    const parsed = parse(good) as { issuerHost: string; registrationEndpoint: string };
    expect(parsed.issuerHost).toBe("sso.juspay.net");
    expect(parsed.registrationEndpoint).toBe("https://sso.juspay.net/register");
  });

  it("enforces RFC 8414 §3.3 — the document must claim the issuer we asked", () => {
    // Serving this at sso.juspay.net's own well-known path is how a host would
    // otherwise hand us an authorization server it does not control.
    expect(parse({ ...good, issuer: "https://elsewhere.juspay.net" })).toBeNull();
  });

  it("refuses endpoints on a host unrelated to the issuer", () => {
    expect(parse({ ...good, token_endpoint: "https://collector.example/token" })).toBeNull();
    expect(parse({ ...good, authorization_endpoint: "https://collector.example/auth" })).toBeNull();
  });

  it("accepts the ordinary www-authorize / api-token split", () => {
    // canva.com does exactly this in production: consent on www.canva.com,
    // token exchange on api.canva.com. An exact-host rule refused it.
    const parsed = parse({
      ...good,
      authorization_endpoint: "https://www.juspay.net/oauth/authorize",
      token_endpoint: "https://api.juspay.net/oauth/token",
      issuer: "https://sso.juspay.net",
    }) as { tokenEndpoint: string } | null;
    expect(parsed?.tokenEndpoint).toBe("https://api.juspay.net/oauth/token");
  });

  it("drops a registration endpoint on an unrelated host rather than the whole document", () => {
    const parsed = parse({ ...good, registration_endpoint: "https://elsewhere.example/register" }) as
      { registrationEndpoint: string | null };
    expect(parsed.registrationEndpoint).toBeNull();
  });

  it("refuses a server that advertises PKCE without S256", () => {
    expect(parse({ ...good, code_challenge_methods_supported: ["plain"] })).toBeNull();
  });

  it("refuses plain http and an unrelated issuer", () => {
    expect(parse({ ...good, issuer: "http://sso.juspay.net" }, "http://sso.juspay.net")).toBeNull();
    expect(
      parseAuthServerMetadata(
        { ...good, issuer: "https://accounts.google.com", authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth", token_endpoint: "https://accounts.google.com/token", registration_endpoint: "https://accounts.google.com/register" },
        "evil.example",
        "authorization-server",
        null,
        "https://accounts.google.com",
      ),
    ).toBeNull();
  });
});

describe("resourceMetadataUrlFrom", () => {
  it("reads the RFC 9728 pointer in both quoted and bare forms", () => {
    expect(resourceMetadataUrlFrom('Bearer resource_metadata="https://x/.well-known/y"'))
      .toBe("https://x/.well-known/y");
    expect(resourceMetadataUrlFrom("Bearer realm=\"r\", resource_metadata=https://x/y"))
      .toBe("https://x/y");
  });

  it("returns null for challenges that carry no pointer", () => {
    // What Bitbucket Data Center actually sends: OAuth 1.0a, no pointer.
    expect(resourceMetadataUrlFrom('OAuth realm="https%3A%2F%2Fbitbucket.juspay.net"')).toBeNull();
    expect(resourceMetadataUrlFrom(null)).toBeNull();
    expect(resourceMetadataUrlFrom(undefined)).toBeNull();
  });
});

describe("detectCredentialHint", () => {
  it("sends a Bitbucket Data Center user to the HTTP access token servlet", async () => {
    mocks.safeFetch.mockResolvedValue(
      page({ "x-arequestid": "*ABC1x1x1" }, "Log into Atlassian - Juspay Bitbucket"),
    );

    const hint = await detectCredentialHint("bitbucket.example.net");
    expect(hint?.product).toBe("Bitbucket Data Center");
    expect(hint?.tokenUrl).toBe("https://bitbucket.example.net/plugins/servlet/access-tokens/manage");
    // An HTTP access token is a bearer, not a cookie — preselecting the wrong
    // transport is the difference between working and a baffling 401.
    expect(hint?.scheme).toBe("bearer");
  });

  it("refuses to guess for Atlassian products it cannot identify", async () => {
    // Jira and Confluence DC also stamp x-arequestid, and their tokens live
    // somewhere else entirely.
    mocks.safeFetch.mockResolvedValue(page({ "x-arequestid": "*ABC1x1x1" }, "Log in - Jira"));
    expect(await detectCredentialHint("jira.example.net")).toBeNull();
  });

  it("identifies GitLab and GitHub from their own response headers", async () => {
    mocks.safeFetch.mockResolvedValue(page({ "x-gitlab-meta": '{"correlation_id":"x"}' }));
    expect((await detectCredentialHint("gitlab.example.net"))?.product).toBe("GitLab");

    mocks.safeFetch.mockResolvedValue(page({ "x-github-request-id": "1:2:3" }));
    expect((await detectCredentialHint("github.com"))?.product).toBe("GitHub");
    mocks.safeFetch.mockResolvedValue(page({ "x-github-request-id": "1:2:3" }));
    expect((await detectCredentialHint("ghe.example.net"))?.product).toBe("GitHub Enterprise");
  });

  it("says nothing for a host it does not recognise", async () => {
    mocks.safeFetch.mockResolvedValue(page({}, "Some Internal Tool"));
    expect(await detectCredentialHint("tool.example.net")).toBeNull();
  });

  it("fails closed when the host cannot be reached", async () => {
    /*
     * Throws SYNCHRONOUSLY, which is equivalent at the `await` site but avoids a
     * vitest quirk: an async mock that rejects has its result promise stored in
     * `mock.results`, and nothing ever handles that stored copy — so vitest
     * reports an unhandled rejection and fails the test even though the code
     * under test caught the error and returned null exactly as intended.
     */
    mocks.safeFetch.mockImplementation(() => { throw new Error("dns"); });
    expect(await detectCredentialHint("gone.example.net")).toBeNull();
  });

  it("truncates rather than throwing on a large homepage", async () => {
    // Regression: the probe originally capped the body WITHOUT truncation, so
    // safeFetch threw `response-too-large` on any sizeable homepage and the
    // host went unidentified — even though the headers alone were enough.
    // Caught on github.com.
    mocks.safeFetch.mockResolvedValue(page({ "x-github-request-id": "1:2:3" }));
    await detectCredentialHint("github.com");
    expect(mocks.safeFetch.mock.calls[0]?.[2]).toMatchObject({ truncateOversizeBody: true });
  });
});
