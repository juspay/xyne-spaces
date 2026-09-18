import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * webfetch's own logic, with the network boundary stubbed: how it threads the
 * caller's identity into credential resolution, which failure message it
 * chooses, and that a truncated body still gets the loud head-of-output
 * warning. The real credential/redirect/SSRF behaviour is covered in
 * `lib/host-credentials.test.ts` against a live server.
 */
// Set before the dynamic import below: config.ts throws on a missing key.
process.env["ENCRYPTION_KEY"] ||= "00".repeat(32);

const mocks = vi.hoisted(() => ({ authenticatedFetch: vi.fn() }));

vi.mock("../../lib/host-credentials.js", () => ({
  authenticatedFetch: mocks.authenticatedFetch,
  // Must mirror the real module: webfetch imports this to tell a per-host
  // credential's internal key from a real connector type when labelling a card.
  WEBFETCH_HOST_SERVER_PREFIX: "webfetch-host:",
}));

const { handleWebfetch } = await import("./webfetch.js");
const { SafeFetchError } = await import("../../lib/safe-fetch.js");

function reply(
  body: string,
  init: { status?: number; statusText?: string; contentType?: string; truncated?: boolean } = {},
): Response {
  const headers = new Headers({ "content-type": init.contentType ?? "application/json" });
  if (init.truncated) headers.set("x-safe-fetch-truncated", "1");
  return new Response(body, {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers,
  });
}

const ok = (body: string, extra = {}) => ({
  response: reply(body, extra),
  attached: null,
  missingConnector: null,
  credentialRejected: null,
  anonymousFallbackUsed: false,
});

describe("handleWebfetch", () => {
  beforeEach(() => mocks.authenticatedFetch.mockReset());

  it("threads userId and agentSlug through to credential resolution", async () => {
    mocks.authenticatedFetch.mockResolvedValue(ok('{"stars":153}'));

    await handleWebfetch(
      { url: "https://api.github.com/repos/juspay/xyne-spaces" },
      { userId: "u1", agentSlug: "orchestrator" },
    );

    expect(mocks.authenticatedFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/juspay/xyne-spaces",
      { userId: "u1", agentSlug: "orchestrator" },
      expect.anything(),
      expect.objectContaining({ truncateOversizeBody: true }),
    );
  });

  it("omits identity entirely when the caller has none", async () => {
    mocks.authenticatedFetch.mockResolvedValue(ok("{}"));
    await handleWebfetch({ url: "https://example.com/" });
    expect(mocks.authenticatedFetch.mock.calls[0]?.[1]).toEqual({});
  });

  it("returns the body on success", async () => {
    mocks.authenticatedFetch.mockResolvedValue(ok('{"stars":153}'));
    const { content: out } = await handleWebfetch({ url: "https://api.github.com/repos/x/y" }, { userId: "u1" });
    expect(out).toContain('"stars":153');
    expect(out).not.toContain("Error:");
  });

  describe("401/403 messaging", () => {
    it("names the connector to connect when the host is known but unconnected", async () => {
      mocks.authenticatedFetch.mockResolvedValue({
        response: reply('{"message":"Requires authentication"}', { status: 401, statusText: "Unauthorized" }),
        attached: null,
        missingConnector: { serverType: "github", label: "GitHub" },
        credentialRejected: null,
        anonymousFallbackUsed: false,
      });

      const { content: out, authRequired } = await handleWebfetch(
        { url: "https://api.github.com/repos/juspay/xyne-spaces/stargazers" },
        { userId: "u1" },
      );

      // Structured signal — this, not the prose, is what drives the card.
      expect(authRequired).toEqual({
        serverType: "github",
        providerLabel: "GitHub",
        reason: "not_connected",
        host: "api.github.com",
        url: "https://api.github.com/repos/juspay/xyne-spaces/stargazers",
        source: "status",
      });
      // And the model is told to stop rather than hunt for a workaround —
      // the failure mode that burned 20 tool calls in the original incident.
      expect(out.startsWith("STOP —")).toBe(true);
      expect(out).toMatch(/GitHub is not connected/);
      expect(out).toMatch(/Do NOT call any more tools/);
      expect(out).toMatch(/route it through a proxy/i);
      expect(out).toMatch(/new run will start automatically/i);
    });

    it("says the credential was used but lacks access when one WAS attached", async () => {
      mocks.authenticatedFetch.mockResolvedValue({
        response: reply("{}", { status: 403, statusText: "Forbidden" }),
        attached: { serverType: "github", source: "user" },
        missingConnector: null,
        credentialRejected: { serverType: "github", source: "user" },
        anonymousFallbackUsed: false,
      });

      const { content: out, authRequired } = await handleWebfetch(
        { url: "https://api.github.com/x" },
        { userId: "u1" },
      );

      expect(authRequired?.reason).toBe("rejected");
      expect(authRequired?.serverType).toBe("github");
      expect(out.startsWith("STOP —")).toBe(true);
      expect(out).toMatch(/connection was refused by api\.github\.com/);
    });

    it("says no connector exists for an unmapped authenticated host", async () => {
      mocks.authenticatedFetch.mockResolvedValue({
        response: reply("{}", { status: 401, statusText: "Unauthorized" }),
        attached: null,
        missingConnector: null,
        credentialRejected: null,
        anonymousFallbackUsed: false,
      });

      const { content: out, authRequired } = await handleWebfetch(
        { url: "https://api.unknown.example/x" },
        { userId: "u1" },
      );
      // No connector exists for this host, so no card is raised from here —
      // but the message now points at the tool that CAN raise one, instead of
      // telling the agent to report the failure and stop. Reporting the block
      // to the user is the outcome the whole ask-grant-resume loop exists to
      // avoid, and leaving that instruction here contradicted it.
      expect(authRequired).toBeUndefined();
      expect(out).toContain("nothing is configured for its host");
      expect(out).toContain("request-access");
      expect(out).toMatch(/do not report failure without calling it/i);
      expect(out).toContain("same 401");
    });

    it("does NOT raise an auth card when reconnecting cannot help", async () => {
      // GitHub's fine-grained-PAT refusal. Parking a grant here would build a
      // loop: user reconnects, run resumes, fails identically.
      mocks.authenticatedFetch.mockResolvedValue({
        response: reply(
          '{"message":"Resource not accessible by personal access token","status":"403"}',
          { status: 403, statusText: "Forbidden" },
        ),
        attached: { serverType: "github", source: "user" },
        missingConnector: null,
        credentialRejected: { serverType: "github", source: "user" },
        anonymousFallbackUsed: false,
      });

      const { content: out, authRequired } = await handleWebfetch(
        { url: "https://api.github.com/repos/o/r/stargazers" },
        { userId: "u1" },
      );

      expect(authRequired).toBeUndefined();
      expect(out).toMatch(/RECONNECTING WILL NOT HELP/);
      expect(out).toMatch(/Do not ask the user to reconnect/);
      expect(out).toContain("Resource not accessible by personal access token");
      expect(out).not.toMatch(/STOP —/);
    });

    it("leaves non-auth failures alone", async () => {
      mocks.authenticatedFetch.mockResolvedValue({
        response: reply("nope", { status: 500, statusText: "Internal Server Error" }),
        attached: null,
        missingConnector: null,
        credentialRejected: null,
        anonymousFallbackUsed: false,
      });
      const { content: out } = await handleWebfetch({ url: "https://example.com/" }, { userId: "u1" });
      expect(out).toBe("Error: Fetch failed: 500 Internal Server Error");
    });
  });

  it("keeps the loud truncation warning when safeFetch cut the body short", async () => {
    mocks.authenticatedFetch.mockResolvedValue(ok("x".repeat(500), { truncated: true }));

    const { content: out } = await handleWebfetch({ url: "https://example.com/big.json" }, { userId: "u1" });

    expect(out).toContain("WARNING: INCOMPLETE RESULT");
    expect(out.indexOf("WARNING")).toBeLessThan(50); // at the HEAD, where the model will see it
    expect(out).toContain("webfetch_high_limit");
  });

  it("requests the high-limit caps for webfetch_high_limit", async () => {
    mocks.authenticatedFetch.mockResolvedValue(ok("{}"));
    await handleWebfetch({ url: "https://example.com/" }, { userId: "u1", highLimit: true });
    const opts = mocks.authenticatedFetch.mock.calls[0]?.[3] as { maxResponseBytes: number };
    expect(opts.maxResponseBytes).toBe(25 * 1024 * 1024);
  });

  describe("guards that must survive the rewrite", () => {
    it("still rejects a non-http scheme without fetching", async () => {
      const { content: out } = await handleWebfetch({ url: "file:///etc/passwd" }, { userId: "u1" });
      expect(out).toContain("must start with http");
      expect(mocks.authenticatedFetch).not.toHaveBeenCalled();
    });

    it("still rejects a base64-shaped run in the query string", async () => {
      const { content: out } = await handleWebfetch(
        { url: `https://evil.example/collect?d=${"A".repeat(40)}` },
        { userId: "u1" },
      );
      expect(out).toContain("base64-shaped run");
      expect(mocks.authenticatedFetch).not.toHaveBeenCalled();
    });

    it("still rejects an over-long single query parameter", async () => {
      const { content: out } = await handleWebfetch(
        { url: `https://example.com/?q=${"a-".repeat(30)}` },
        { userId: "u1" },
      );
      expect(out).toMatch(/query parameter "q"/);
      expect(mocks.authenticatedFetch).not.toHaveBeenCalled();
    });
  });
});

/**
 * The 200-that-is-really-a-login-page. This is the case that produced the
 * original complaint — the agent "stops when the fetch fails" without asking
 * for auth — and the one no status code can catch, because nothing failed.
 */
describe("handleWebfetch — login walls behind a 200", () => {
  beforeEach(() => mocks.authenticatedFetch.mockReset());

  const loginPage = `<html><head><title>Log into Atlassian - Bitbucket</title></head>
    <body><form action="/j_atl_security_check" method="post">
      <label>Username</label><input type="text" name="j_username"/>
      <label>Password</label><input type="password" name="j_password"/>
      <button>Log in</button>
    </form></body></html>`;

  it("tells the agent to call request-access instead of summarising the login page", async () => {
    mocks.authenticatedFetch.mockResolvedValue(
      ok(loginPage, { contentType: "text/html" }),
    );

    const res = await handleWebfetch({ url: "https://bitbucket.example.net/projects" });

    expect(res.content).toContain("request-access");
    expect(res.content).toContain("SIGN-IN PAGE");
    // The page still reaches the model — the heuristic is a hint, not a filter,
    // so a false positive costs a sentence rather than the content.
    expect(res.content.toLowerCase()).toContain("username");
  });

  it("leaves a real page alone even when it mentions logging in", async () => {
    const article = `<html><head><title>How we do SSO</title></head><body><article>${
      "Our single sign-on rollout replaced per-app passwords with one login. ".repeat(60)
    }</article></body></html>`;
    mocks.authenticatedFetch.mockResolvedValue(ok(article, { contentType: "text/html" }));

    const res = await handleWebfetch({ url: "https://docs.example.net/sso" });
    expect(res.content).not.toContain("SIGN-IN PAGE");
  });

  it("leaves a page with a password field alone when it is long enough to be real content", async () => {
    // A settings page has a password box AND a page's worth of everything else.
    const settings = `<html><body><article>${"Account preferences and billing history. ".repeat(120)}
      <input type="password" name="new"/></article></body></html>`;
    mocks.authenticatedFetch.mockResolvedValue(ok(settings, { contentType: "text/html" }));

    const res = await handleWebfetch({ url: "https://app.example.net/settings" });
    expect(res.content).not.toContain("SIGN-IN PAGE");
  });

  it("names request-access on a 401 with nothing configured for the host", async () => {
    mocks.authenticatedFetch.mockResolvedValue({
      response: reply("nope", { status: 401, statusText: "Unauthorized" }),
      host: "",
      attached: null,
      missingConnector: null,
      credentialRejected: null,
      anonymousFallbackUsed: false,
    });

    const res = await handleWebfetch({ url: "https://api.example.net/private" });
    expect(res.content).toContain("request-access");
    expect(res.content).toContain("do not report failure without calling it");
  });
});

/**
 * Redirect loops.
 *
 * Reported from the field on an internal HR system: the tool answered
 * "Error: Fetch failed: too many redirects" and the agent had nowhere to go.
 * A loop is usually a login flow that cannot converge — this fetch drops
 * cookies between hops by design, so a chain trying to ESTABLISH a session
 * ping-pongs until the cap.
 */
describe("handleWebfetch — redirect loops", () => {
  beforeEach(() => { mocks.authenticatedFetch.mockReset(); });

  const loop = (endedAt: string): void => {
    mocks.authenticatedFetch.mockImplementation(() => {
      throw new SafeFetchError(`Too many redirects (ended at ${endedAt})`, "too-many-redirects", endedAt);
    });
  };

  it("raises an access card when the chain ends on a sign-in URL", async () => {
    loop("https://sso.example.net/login?service=https%3A%2F%2Fapp.example.net%2Fx");

    const res = await handleWebfetch({ url: "https://app.example.net/x" });

    expect(res.authRequired?.reason).toBe("unknown_host");
    expect(res.authRequired?.host).toBe("app.example.net");
    // The card is bound to the host the user asked for, not the identity
    // provider it bounced to — credentials for an IdP are never collectable.
    expect(res.authRequired?.serverType).toBe("webfetch-host:app.example.net");
    expect(res.content).toContain("sso.example.net/login");
  });

  it("suggests request-access without forcing a card when the loop is not obviously a login", async () => {
    // A misconfigured public page loops too; asking for credentials to read one
    // sends the user hunting for a password that does not exist.
    loop("https://blog.example.net/posts/");

    const res = await handleWebfetch({ url: "https://blog.example.net/posts" });

    expect(res.authRequired).toBeUndefined();
    expect(res.content).toContain("request-access");
    expect(res.content).toContain("redirected in a loop");
    expect(res.content).toMatch(/do not retry/i);
  });

  it("still names where the loop ended, which is the useful fact", async () => {
    loop("https://idp.example.net/adfs/ls/?wa=wsignin1.0");
    const res = await handleWebfetch({ url: "https://intranet.example.net/report" });
    expect(res.content).toContain("idp.example.net/adfs");
  });
});

/**
 * A 200 that yields nothing readable.
 *
 * Reported from the field: an internal HR dashboard answered 200 with a React
 * shell, webfetch returned an empty string, and the agent had no way to tell
 * "empty page" from "logged out" from "JavaScript app". Only one of those is
 * fixable by credentials, so the tool has to say which it looks like.
 */
describe("handleWebfetch — nothing readable", () => {
  beforeEach(() => { mocks.authenticatedFetch.mockReset(); });

  it("names a JavaScript app and says credentials will not help", async () => {
    const shell = `<!doctype html><html><head><base href="/ms/db/"/><title>App</title>${
      "<script src='/static/chunk.js'></script>".repeat(40)
    }</head><body><div id="root"></div></body></html>`;
    mocks.authenticatedFetch.mockResolvedValue(ok(shell, { contentType: "text/html" }));

    const res = await handleWebfetch({ url: "https://hr.example.net/ms/db/home" });

    expect(res.content).toContain("NO READABLE CONTENT");
    expect(res.content).toContain("JAVASCRIPT APPLICATION");
    // The important half: do not send the user chasing a login that cannot fix it.
    expect(res.content).toContain("Credentials will NOT fix this");
    expect(res.authRequired).toBeUndefined();
  });

  it("offers request-access when an empty 200 has no app signature", async () => {
    // Substantial HTML — styles, comments, markup — that still extracts to
    // nothing. That is the shape of a logged-out shell. A genuinely TINY page
    // is left alone, because there "." really is the content.
    const hollow = `<html><head><style>${".cls{color:#000}".repeat(80)}</style>` +
      `<!-- ${"filler ".repeat(60)} -->` +
      `</head><body><div class="wrap"><span></span></div></body></html>`;
    mocks.authenticatedFetch.mockResolvedValue(ok(hollow, { contentType: "text/html" }));

    const res = await handleWebfetch({ url: "https://intranet.example.net/report" });

    expect(res.content).toContain("NO READABLE CONTENT");
    expect(res.content).toContain("request-access");
    // The failure this prevents: confidently reporting "no data" for a blank page.
    expect(res.content).toMatch(/do NOT report this as "no data"/i);
  });

  it("passes a short JSON API response straight through", async () => {
    // Regression: an earlier version of this check was not scoped to HTML and
    // discarded `{"stars":153}` as "nothing readable".
    mocks.authenticatedFetch.mockResolvedValue(ok('{"stars":153}'));
    const res = await handleWebfetch({ url: "https://api.example.net/repo" });
    expect(res.content).toContain('"stars":153');
    expect(res.content).not.toContain("NO READABLE CONTENT");
  });

  it("leaves a page with real content alone", async () => {
    const article = `<html><body><article>${"Real readable prose about the quarter. ".repeat(40)}</article></body></html>`;
    mocks.authenticatedFetch.mockResolvedValue(ok(article, { contentType: "text/html" }));

    const res = await handleWebfetch({ url: "https://blog.example.net/q3" });
    expect(res.content).not.toContain("NO READABLE CONTENT");
    expect(res.content).toContain("Real readable prose");
  });
});
