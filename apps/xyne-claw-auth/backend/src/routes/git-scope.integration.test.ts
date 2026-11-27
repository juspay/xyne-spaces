/**
 * The git-scope route on a real Express app with the real middlewares
 * (requireRuntime, requireSessionToken), real config, real session tokens and a
 * real Postgres for agents, users and stored profiles. Only Redis (the
 * assertion replay set, kept in memory with the same SET NX semantics) and the
 * Spaces directory lookup (user → workspace) are fakes.
 *
 * Needs a throwaway database with the schema pushed:
 *   GIT_SCOPE_TEST_DATABASE_URL=postgresql://user@127.0.0.1:PORT/db pnpm exec vitest run src/routes/git-scope.integration.test.ts
 * Skipped without it.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, randomUUID, sign as cryptoSign, type KeyObject } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env["GIT_SCOPE_TEST_DATABASE_URL"];

const keys = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { generateKeyPairSync: gen } = require("node:crypto") as typeof import("node:crypto");
  const pair = () => gen("ec", { namedCurve: "prime256v1" });
  const runtime = pair();
  const scope = pair();
  const pem = (k: import("node:crypto").KeyObject, type: "pkcs8" | "spki") => k.export({ type, format: "pem" } as never).toString();
  process.env["ENCRYPTION_KEY"] = "11".repeat(32);
  if (process.env["GIT_SCOPE_TEST_DATABASE_URL"]) process.env["DATABASE_URL"] = process.env["GIT_SCOPE_TEST_DATABASE_URL"];
  process.env["CLAW_RUNTIME_PUBLIC_KEYS"] = JSON.stringify({ "runtime-1": pem(runtime.publicKey, "spki") });
  process.env["CLAW_GIT_SCOPE_PRIVATE_KEY"] = pem(scope.privateKey, "pkcs8");
  process.env["CLAW_GIT_SCOPE_KEY_ID"] = "git-scope-1";
  return { runtime, scopePublicPem: pem(scope.publicKey, "spki") };
});

const replay = vi.hoisted(() => new Set<string>());
vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      set: async (key: string, _v: string, _ex: string, _ttl: number, nx: string) => {
        if (nx !== "NX") throw new Error("expected SET NX");
        if (replay.has(key)) return null;
        replay.add(key);
        return "OK";
      },
    }),
  },
}));
const workspaces = vi.hoisted(() => new Map<string, string>());
vi.mock("../lib/spaces-db.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/spaces-db.js")>()),
  getWorkspaceIdForUser: async (userId: string) => workspaces.get(userId) ?? null,
}));

const BASE = "/claw/api/v1";
const NS = "xyne-apps";
const now = () => Math.floor(Date.now() / 1000);

function assertion(method: string, path: string, key: KeyObject = keys.runtime.privateKey): string {
  const t = now();
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const input = `${b64({ alg: "ES256", typ: "xyne-service+jwt", kid: "runtime-1" })}.${b64({ iss: "xyne-claw", aud: "xyne-claw-auth", htm: method, htu: path, iat: t, exp: t + 60, jti: randomUUID() })}`;
  return `${input}.${cryptoSign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

describe.skipIf(!DB_URL)("POST /claw/api/v1/sessions/:sessionId/git-scope (real app, real middlewares)", () => {
  let server: Server;
  let baseUrl: string;
  let mint: typeof import("../lib/session-tokens.js").mintSessionToken;
  let prisma: typeof import("../db.js").prisma;
  let CONFIG: typeof import("../config.js").CONFIG;
  let verifyGitScope: typeof import("xyne-claw-shared").verifyGitScope;
  let builtInTemplate: string;
  const tag = randomUUID().slice(0, 8);
  const orgA = `org-a-${tag}`;
  const userA = `user-a-${tag}`;
  const userB = `user-b-${tag}`;
  const keyA = `ga-${tag}`;
  const keyAOff = `ga-off-${tag}`;
  const keyB = `gb-${tag}`;

  beforeAll(async () => {
    const express = (await import("express")).default;
    ({ mintSessionToken: mint } = await import("../lib/session-tokens.js"));
    ({ prisma } = await import("../db.js"));
    ({ CONFIG } = await import("../config.js"));
    const shared = await import("xyne-claw-shared");
    verifyGitScope = shared.verifyGitScope;
    builtInTemplate = shared.DEFAULT_REPO_CONFIGS["xyne-spaces"]!.template;
    const { sdlcRuntimeCredentialsRouter } = await import("./sdlc-runtime-credentials.js");
    const { gitScopeRouter } = await import("./git-scope.js");

    await prisma.organization.create({ data: { id: orgA, name: `Org A ${tag}`, createdBy: "test" } });
    for (const id of [userA, userB]) {
      await prisma.user.create({ data: { id, email: `${id}@example.test`, name: id, orgId: orgA } });
    }
    const agent = (slug: string, config: object, isDefault = false) =>
      prisma.agent.create({ data: { slug, name: slug, systemPrompt: "x", orgId: orgA, config, isDefault } });
    await agent("free", {}, true);
    await agent("pinned", { sandboxRepo: keyA });
    const row = (key: string, workspaceId: string, repo: string, enabled = true) =>
      prisma.sandboxRepoConfig.create({
        data: {
          key,
          workspaceId,
          enabled,
          config: { slug: key, name: key, description: "", repoUrl: repo, defaultBranch: "main", workDir: "/workspace/r", template: "ws-template", steps: [] },
        },
      });
    await row(keyA, "ws-a", "https://github.com/acme/alpha.git");
    await row(keyAOff, "ws-a", "https://github.com/acme/off.git", false);
    await row(keyB, "ws-b", "https://github.com/acme/beta.git");
    workspaces.set(userA, "ws-a");
    workspaces.set(userB, "ws-b");

    const app = express();
    app.use(express.json());
    // Same mounts, same order as http/routes.ts.
    app.use(`${BASE}/sessions`, sdlcRuntimeCredentialsRouter);
    app.use(`${BASE}/sessions`, gitScopeRouter);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prisma) {
      await prisma.sandboxRepoConfig.deleteMany({ where: { key: { in: [keyA, keyAOff, keyB, `sbx-git`] } } });
      await prisma.agent.deleteMany({ where: { orgId: orgA } });
      await prisma.user.deleteMany({ where: { orgId: orgA } });
      await prisma.organization.deleteMany({ where: { id: orgA } });
      await prisma.$disconnect();
    }
  });

  const body = (over: Record<string, unknown> = {}) => ({
    profile: keyA,
    claimName: `claim-${tag}`,
    namespace: NS,
    template: "ws-template",
    endTime: now() + 3600,
    ...over,
  });

  async function call(opts: {
    user?: string;
    agentSlug?: string;
    sessionId?: string;
    tokenSessionId?: string;
    body?: unknown;
    assertionHeader?: string | null;
    bearer?: string | null;
  } = {}) {
    const sessionId = opts.sessionId ?? `sess-${randomUUID()}`;
    const path = `${BASE}/sessions/${sessionId}/git-scope`;
    const token = mint({
      sessionId: opts.tokenSessionId ?? sessionId,
      userId: opts.user ?? userA,
      ...(opts.agentSlug ? { agentSlug: opts.agentSlug } : {}),
      ttlSeconds: 600,
    });
    const headers: Record<string, string> = { "content-type": "application/json" };
    const proof = opts.assertionHeader === undefined ? assertion("POST", path) : opts.assertionHeader;
    if (proof !== null) headers["x-service-assertion"] = proof;
    const bearer = opts.bearer === undefined ? token : opts.bearer;
    if (bearer !== null) headers["authorization"] = `Bearer ${bearer}`;
    const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(opts.body ?? body()) });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  it("signs for the run's own workspace profile; the token verifies with the public key", async () => {
    const b = body();
    const res = await call({ body: b });
    expect(res.status).toBe(200);
    expect(Object.keys(res.json)).toEqual(["token"]);
    const verified = verifyGitScope(res.json["token"], {
      keys: { "git-scope-1": keys.scopePublicPem },
      expected: { claim: b.claimName, namespace: NS, template: "ws-template" },
    });
    if (!verified.ok) throw new Error(verified.reason);
    expect(verified.scope).toMatchObject({ profile: keyA, exp: b.endTime, repos: [{ repo: "github.com/acme/alpha", access: "rw" }] });
    expect(Math.abs(verified.scope.iat - now())).toBeLessThan(5);
  });

  it("workspace isolation: a workspace-A run cannot get workspace B's profile, and B's run can", async () => {
    expect((await call({ body: body({ profile: keyB }) })).status).toBe(404);
    expect((await call({ user: userB, body: body({ profile: keyB }) })).status).toBe(200);
    expect((await call({ user: userB, body: body({ profile: keyA }) })).status).toBe(404);
  });

  it("built-in profiles are allowed for any workspace, with any template of the family", async () => {
    for (const user of [userA, userB]) {
      for (const template of [builtInTemplate, `${builtInTemplate}-c`]) {
        expect((await call({ user, body: body({ profile: "xyne-spaces", template }) })).status).toBe(200);
      }
    }
    expect((await call({ body: body({ profile: "xyne-spaces", template: "euler-workspace-template" }) })).status).toBe(400);
  });

  it("an agent's pin does not limit signing; the workspace still does", async () => {
    expect((await call({ agentSlug: "pinned", body: body() })).status).toBe(200);
    expect((await call({ agentSlug: "pinned", body: body({ profile: "xyne-spaces", template: builtInTemplate }) })).status).toBe(200);
    // The token's user is in workspace B: workspace A's profile stays closed.
    expect((await call({ user: userB, agentSlug: "pinned", body: body() })).status).toBe(404);
  });

  it("refusals: disabled, unknown, sbx-git without a profile (404); bad input (400)", async () => {
    expect((await call({ body: body({ profile: keyAOff }) })).status).toBe(404);
    expect((await call({ body: body({ profile: "no-such-profile" }) })).status).toBe(404);
    expect((await call({ body: body({ profile: "sbx-git" }) })).status).toBe(404);
    expect((await call({ body: { ...body(), workspaceId: "ws-b" } })).status).toBe(400);
    expect((await call({ body: body({ claimName: "Bad_Name" }) })).status).toBe(400);
    // No upper limit on endTime: it is the claim's own end time.
    expect((await call({ body: body({ endTime: now() + 8 * 24 * 3600 }) })).status).toBe(200);
    expect((await call({ body: body({ template: "kata-workspace-template" }) })).status).toBe(400);
  });

  it("sbx-git is signed once a profile with that key exists in the run's effective profiles", async () => {
    await prisma.sandboxRepoConfig.create({
      data: { key: "sbx-git", workspaceId: "ws-a", enabled: true, config: { slug: "sbx-git", name: "sbx", description: "", repoUrl: "https://github.com/acme/alpha.git", defaultBranch: "main", workDir: "/w", template: "ws-template", steps: [] } },
    });
    expect((await call({ body: body({ profile: "sbx-git" }) })).status).toBe(200);
    expect((await call({ user: userB, body: body({ profile: "sbx-git" }) })).status).toBe(404);
  });

  it("guards: no service proof, a stranger's proof, a replayed proof, no session token, another session's token", async () => {
    expect((await call({ assertionHeader: null })).status).toBe(401);
    const stranger = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
    const sessionId = `sess-${randomUUID()}`;
    const path = `${BASE}/sessions/${sessionId}/git-scope`;
    expect((await call({ sessionId, assertionHeader: assertion("POST", path, stranger) })).status).toBe(401);
    const once = assertion("POST", path);
    expect((await call({ sessionId, assertionHeader: once })).status).toBe(200);
    expect((await call({ sessionId, assertionHeader: once })).status).toBe(401);
    expect((await call({ bearer: null })).status).toBe(401);
    expect((await call({ bearer: "forged.token" })).status).toBe(401);
    expect((await call({ tokenSessionId: "another-session" })).status).toBe(403);
  });

  it("answers 503 with a clear message while the signing key is not configured", async () => {
    const config = CONFIG as unknown as { clawGitScopeKeyId: string };
    const saved = config.clawGitScopeKeyId;
    config.clawGitScopeKeyId = "";
    try {
      const res = await call();
      expect(res.status).toBe(503);
      expect(String(res.json["error"])).toContain("CLAW_GIT_SCOPE_PRIVATE_KEY");
    } finally {
      config.clawGitScopeKeyId = saved;
    }
  });
});
