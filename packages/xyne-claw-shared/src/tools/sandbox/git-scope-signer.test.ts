import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { signGitScope, verifyGitScope } from "../../git-scope/token.js";
import {
  checkGitScopeToken,
  gitScopeForProfile,
  gitScopeSignerUrl,
  GitScopeSignerError,
  requestGitScope,
  type GitScopeSignerTransport,
  type GitScopeSignRequest,
} from "./git-scope-signer.js";
import { startFakeSigner, type FakeSigner } from "./__tests__/fakes.js";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const NOW = Math.floor(Date.now() / 1000);

const request: GitScopeSignRequest = {
  profile: "proj-a",
  claimName: "kata-claim-1234abcd",
  namespace: "test-ns",
  template: "test-tpl",
  endTime: NOW + 3600,
};

function tokenFor(overrides: Partial<{ claim: string; ns: string; tpl: string; profile: string; exp: number; iat: number }> = {}): string {
  return signGitScope(
    {
      v: 1,
      claim: request.claimName,
      ns: request.namespace,
      tpl: request.template,
      profile: request.profile,
      iat: NOW,
      exp: request.endTime,
      repos: [{ repo: "example.test/acme/app", access: "rw" }],
      ...overrides,
    },
    PRIVATE_PEM,
    "k1",
  );
}

describe("checkGitScopeToken", () => {
  it("accepts a list made for this claim", () => {
    expect(checkGitScopeToken(tokenFor(), request)).toBeNull();
  });

  it.each([
    ["claim", { claim: "kata-claim-other000" }, "another claim"],
    ["namespace", { ns: "other-ns" }, "another namespace"],
    ["template", { tpl: "other-tpl" }, "another template"],
    ["profile", { profile: "proj-b" }, "another profile"],
    ["end time", { exp: request.endTime + 1 }, "end time"],
  ])("refuses a list for another %s", (_label, overrides, problem) => {
    expect(checkGitScopeToken(tokenFor(overrides), request)).toContain(problem);
  });

  it("refuses tokens that are not well-formed", () => {
    expect(checkGitScopeToken(undefined, request)).toBe("no token");
    expect(checkGitScopeToken("a.b", request)).toContain("three");
    const [h, p] = tokenFor().split(".");
    expect(checkGitScopeToken(`${h}.${p}.AAAA`, request)).toContain("64 bytes");
    const badHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "xyne-git-scope+jwt", kid: "k1" })).toString("base64url");
    expect(checkGitScopeToken(`${badHeader}.${p}.${tokenFor().split(".")[2]}`, request)).toContain("alg/typ");
    const badPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, "base64url").toString()), extra: 1 })).toString("base64url");
    expect(checkGitScopeToken(`${h}.${badPayload}.${tokenFor().split(".")[2]}`, request)).toContain("payload is malformed");
    expect(checkGitScopeToken("x".repeat(20_000), request)).toContain("longer");
  });
});

describe("requestGitScope against a fake claw-auth signer", () => {
  let signer: FakeSigner;
  const proof = (method: string, url: string) => ({ "x-service-assertion": `proof ${method} ${new URL(url).pathname}` });
  const transport = (over: Partial<GitScopeSignerTransport> = {}): GitScopeSignerTransport => ({
    authUrl: signer.url,
    serviceAuth: proof,
    runSessionId: "run-1",
    sessionToken: "session-token-1",
    ...over,
  });
  beforeAll(async () => {
    signer = await startFakeSigner();
  });
  afterAll(async () => {
    await signer.close();
  });
  beforeEach(() => {
    signer.mode = "sign";
    signer.requests.length = 0;
    signer.calls.length = 0;
  });

  it("the route is claw-auth's, for the run session", () => {
    expect(gitScopeSignerUrl("http://auth.local:3003/", "run 1")).toBe("http://auth.local:3003/claw/api/v1/sessions/run%201/git-scope");
  });

  it("sends the request with the runtime proof and the session token; the list verifies with the signer's public key", async () => {
    signer.reposFor["proj-a"] = [{ repo: "example.test/acme/app", access: "rw" }];
    const token = await requestGitScope({ transport: transport({ authUrl: `${signer.url}/` }), request });
    expect(signer.requests).toEqual([request]);
    expect(signer.calls).toEqual([
      { sessionId: "run-1", authorization: "Bearer session-token-1", serviceAssertion: "proof POST /claw/api/v1/sessions/run-1/git-scope" },
    ]);
    const verified = verifyGitScope(token, {
      keys: { [signer.kid]: signer.publicKeyPem },
      expected: { claim: request.claimName, namespace: request.namespace, template: request.template },
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.scope.repos).toEqual([{ repo: "example.test/acme/app", access: "rw" }]);
  });

  it("refuses a list the signer made for another claim", async () => {
    signer.mode = "other-claim";
    await expect(requestGitScope({ transport: transport(), request })).rejects.toThrow(
      /git-scope signer \(claw-auth\) returned an unusable list: token is for another claim/,
    );
  });

  it("fails naming the signer, with claw-auth's reason, when it refuses", async () => {
    signer.mode = 403;
    await expect(requestGitScope({ transport: transport(), request })).rejects.toThrow(
      /git-scope signer \(claw-auth\) refused the request \(HTTP 403: refused by the fake signer\); the sandbox for profile "proj-a" was not created/,
    );
  });

  it("drops a refusal reason that would read as a dead sandbox", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: "Sandbox abc not found" }), { status: 404, headers: { "content-type": "application/json" } })) as typeof fetch;
    const err = (await requestGitScope({ transport: transport(), request, fetchImpl }).catch((e: unknown) => e)) as Error;
    expect(err.message).toBe('The git-scope signer (claw-auth) refused the request (HTTP 404); the sandbox for profile "proj-a" was not created.');
  });

  it("fails before any call when the run has no claw-auth URL, service signer or session", async () => {
    for (const over of [{ authUrl: "" }, { authUrl: undefined }, { serviceAuth: undefined }, { runSessionId: undefined }, { sessionToken: "" }]) {
      const err = await requestGitScope({ transport: transport(over), request }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GitScopeSignerError);
      expect((err as Error).message).toMatch(/cannot be asked from this run/);
    }
    expect(signer.calls).toEqual([]);
  });

  it("fails naming the signer when it cannot be reached", async () => {
    const err = await requestGitScope({ transport: transport({ authUrl: "http://127.0.0.1:1" }), request }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitScopeSignerError);
    expect((err as Error).message).toMatch(/could not be reached/);
    // Must not look like a dead sandbox to the setup fallback (STALE_PATTERNS).
    expect((err as Error).message).not.toMatch(/ECONNREFUSED|HTTP request failed|ECONNRESET/i);
  });

  it("gitScopeForProfile turns a kata claim into the request, endTime in unix seconds", async () => {
    const hook = gitScopeForProfile("proj-a", transport());
    await hook({ claimName: request.claimName, namespace: request.namespace, template: request.template, endTime: new Date(request.endTime * 1000) });
    expect(signer.requests).toEqual([request]);
  });
});
