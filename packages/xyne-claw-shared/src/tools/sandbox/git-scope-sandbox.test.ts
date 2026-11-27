/**
 * End to end through the real sandbox tools and the real kata-sdk client:
 * claims go to a fake Kubernetes API (via KUBECONFIG), commands to a fake
 * sandbox router, list requests to a fake signer that signs with a test key.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifyGitScope } from "../../git-scope/token.js";
import type { ToolExecutionContext } from "../types.js";
import { setRepoConfigLoader } from "./repo-config-source.js";
import { SBX_GIT } from "./repo-configs.js";
import { sandboxCreate, sandboxRepoSetup, sandboxRun, type RepoSetupConfig } from "./tools.js";
import { startFakeK8s, startFakeRouter, startFakeSigner, type ClaimBody, type FakeK8s, type FakeRouter, type FakeSigner } from "./__tests__/fakes.js";

const ANNOTATION = "xyne.ai/git-scope";
const REPO_URL = "ssh://git@example.test/acme/app.git";

function profile(slug: string, extra: Partial<RepoSetupConfig> = {}): RepoSetupConfig {
  return {
    slug,
    name: slug,
    description: slug,
    repoUrl: REPO_URL,
    defaultBranch: "main",
    workDir: "/workspace/app",
    template: "test-tpl",
    steps: [],
    ...extra,
  };
}

const PROFILES: Record<string, RepoSetupConfig> = {
  "proj-a": profile("sandbox-proj-a-setup"),
  "proj-b": profile("sandbox-proj-b-setup"),
  "proj-aux": profile("sandbox-proj-aux-setup", {
    repoUrl: "ssh://git@example.test/acme/aux-app.git",
    template: "test-aux-tpl",
    auxRepos: [{ name: "lib", url: "ssh://git@example.test/acme/lib.git", defaultBranch: "main", workDir: "/workspace/lib" }],
  }),
  "browser-test": (({ repoUrl: _none, ...noRepo }) => noRepo)(
    profile("sandbox-browser-test-setup", { template: "test-browser-tpl", workDir: "/workspace" }),
  ),
};

let k8s: FakeK8s;
let router: FakeRouter;
let signer: FakeSigner;
let conversation = 0;

beforeAll(async () => {
  [k8s, router, signer] = await Promise.all([startFakeK8s(), startFakeRouter(), startFakeSigner()]);
  k8s.useAsKubeconfig();
  setRepoConfigLoader(async () => PROFILES);
});
afterAll(async () => {
  setRepoConfigLoader(null);
  // Sessions destroy their claims when the worker exits (SIGTERM handler), so
  // the fake Kubernetes API stays up (unref'd) until then.
  k8s.unref();
  await Promise.all([router.close(), signer.close()]);
});
beforeEach(() => {
  signer.mode = "sign";
  router.refuseFetch = null;
});

/** A fresh chat in a claw-auth run; `meta` adds to it. `authUrl` overrides claw-auth's address; `noRunSession` drops the run's session. */
function chat(meta: Record<string, string> = {}, authUrl?: string, noRunSession = false): ToolExecutionContext {
  conversation += 1;
  return {
    config: {
      KATA_ROUTER_URL: router.url,
      KATA_NAMESPACE: "test-ns",
      KATA_TEMPLATE: "kata-workspace-template",
      XYNE_CLAW_AUTH_URL: authUrl ?? signer.url,
    },
    meta: { userId: "user-1", conversationId: `conv-${conversation}`, agentSlug: "test-agent", ...meta },
    ...(noRunSession
      ? {}
      : {
          sessionId: `run-${conversation}`,
          sessionToken: `session-token-${conversation}`,
          serviceAuth: (method: string, url: string) => ({ "x-service-assertion": `proof ${method} ${new URL(url).pathname}` }),
        }),
  };
}

function claimsSince(n: number): ClaimBody[] {
  return k8s.claims().slice(n);
}

/** The claim's annotation verifies, with the signer's public key, for exactly this claim. */
function expectVerifiedList(claim: ClaimBody, profileKey: string) {
  const token = claim.metadata.annotations?.[ANNOTATION];
  expect(token).toBeTypeOf("string");
  const result = verifyGitScope(token, {
    keys: { [signer.kid]: signer.publicKeyPem },
    expected: { claim: claim.metadata.name, namespace: claim.metadata.namespace, template: claim.spec.sandboxTemplateRef.name },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.scope.profile).toBe(profileKey);
  expect(result.scope.ns).toBe("test-ns");
  expect(result.scope.exp * 1000).toBe(Date.parse(claim.spec.lifecycle.shutdownTime));
}

describe("sandbox-create", () => {
  it("with no profile: no list requested, claim carries no annotation", async () => {
    const before = k8s.claimBodies.length;
    const requests = signer.requests.length;
    const out = await sandboxCreate.execute({}, chat());
    expect(JSON.parse(out).status).toBe("ready");
    const [claim] = claimsSince(before);
    expect(claimsSince(before)).toHaveLength(1);
    expect(claim!.metadata.annotations).toBeUndefined();
    expect(Object.keys(claim!.metadata)).toEqual(["name", "namespace"]);
    expect(claim!.spec.sandboxTemplateRef.name).toBe("kata-workspace-template");
    expect(signer.requests.length).toBe(requests);
  });

  it("with a template named by the agent and no profile: no annotation", async () => {
    const before = k8s.claimBodies.length;
    await sandboxCreate.execute({ template: "kata-workspace-template" }, chat());
    expect(claimsSince(before)[0]!.metadata.annotations).toBeUndefined();
  });

  it("with a pinned profile: the claim carries a list that verifies for it", async () => {
    const before = k8s.claimBodies.length;
    const calls = signer.calls.length;
    signer.reposFor["proj-a"] = [{ repo: "example.test/acme/app", access: "rw" }];
    const ctx = chat({ sandboxRepo: "proj-a" });
    const out = await sandboxCreate.execute({}, ctx);
    expect(JSON.parse(out).status).toBe("ready");
    const claims = claimsSince(before);
    expect(claims).toHaveLength(1);
    expectVerifiedList(claims[0]!, "proj-a");
    // Asked claw-auth for this run's session, with the runtime proof and the run's session token.
    expect(signer.calls.slice(calls)).toEqual([
      {
        sessionId: ctx.sessionId,
        authorization: `Bearer ${ctx.sessionToken}`,
        serviceAssertion: `proof POST /claw/api/v1/sessions/${ctx.sessionId}/git-scope`,
      },
    ]);
  });

  it("claw-auth refuses (e.g. unknown profile): no claim, its reason is in the error", async () => {
    signer.mode = 403;
    const before = k8s.claimBodies.length;
    const out = await sandboxCreate.execute({}, chat({ sandboxRepo: "proj-a" }));
    expect(out).toMatch(/^Error: The git-scope signer \(claw-auth\) refused the request \(HTTP 403: refused by the fake signer\)/);
    expect(k8s.claimBodies.length).toBe(before);
  });

  it("with a profile matched by repoUrl + profile", async () => {
    const before = k8s.claimBodies.length;
    await sandboxCreate.execute({ repoUrl: REPO_URL, profile: "proj-b" }, chat());
    expectVerifiedList(claimsSince(before)[0]!, "proj-b");
  });

  it("signer down: no claim, error names the signer", async () => {
    const before = k8s.claimBodies.length;
    const out = await sandboxCreate.execute({}, chat({ sandboxRepo: "proj-a" }, "http://127.0.0.1:1"));
    expect(out).toMatch(/^Error: The git-scope signer \(claw-auth\) could not be reached .*profile "proj-a" was not created/);
    expect(k8s.claimBodies.length).toBe(before);
  });

  it("no run session (not a claw-auth run): no claim, error names the signer", async () => {
    const before = k8s.claimBodies.length;
    const out = await sandboxCreate.execute({}, chat({ sandboxRepo: "proj-a" }, undefined, true));
    expect(out).toMatch(/git-scope signer \(claw-auth\) cannot be asked from this run \(no claw-auth URL, service signer or run session token\)/);
    expect(k8s.claimBodies.length).toBe(before);
  });

  it("signer returns a list for another claim: refused, no claim", async () => {
    signer.mode = "other-claim";
    const before = k8s.claimBodies.length;
    const out = await sandboxCreate.execute({}, chat({ sandboxRepo: "proj-a" }));
    expect(out).toMatch(/returned an unusable list: token is for another claim/);
    expect(k8s.claimBodies.length).toBe(before);
  });

  it("profile switch in one chat makes a new claim; same profile or no profile reuses", async () => {
    const ctxA = chat({ sandboxRepo: "proj-a" });
    const before = k8s.claimBodies.length;
    const first = JSON.parse(await sandboxCreate.execute({}, ctxA));
    const again = JSON.parse(await sandboxCreate.execute({}, ctxA));
    expect(again).toMatchObject({ sessionId: first.sessionId, reused: true });
    const noProfile = JSON.parse(await sandboxCreate.execute({}, { ...ctxA, meta: { ...ctxA.meta!, sandboxRepo: "" } }));
    expect(noProfile).toMatchObject({ sessionId: first.sessionId, reused: true });
    const ctxB = { ...ctxA, meta: { ...ctxA.meta!, sandboxRepo: "proj-b" } };
    const switched = JSON.parse(await sandboxCreate.execute({}, ctxB));
    expect(switched.sessionId).not.toBe(first.sessionId);
    const claims = claimsSince(before);
    expect(claims).toHaveLength(2);
    expectVerifiedList(claims[0]!, "proj-a");
    expectVerifiedList(claims[1]!, "proj-b");
  });
});

describe("sandbox-run one-shot", () => {
  it("pinned: the one-shot claim carries the profile's list", async () => {
    const before = k8s.claimBodies.length;
    const out = await sandboxRun.execute({ cmd: "echo hi" }, chat({ sandboxRepo: "proj-a" }));
    expect(JSON.parse(out).exitCode).toBe(0);
    const claims = claimsSince(before);
    expect(claims).toHaveLength(1);
    expectVerifiedList(claims[0]!, "proj-a");
  });

  it("no profile: no annotation", async () => {
    const before = k8s.claimBodies.length;
    await sandboxRun.execute({ cmd: "echo hi" }, chat());
    expect(claimsSince(before)[0]!.metadata.annotations).toBeUndefined();
  });

  it("pinned and signer down: no claim, error names the signer", async () => {
    const before = k8s.claimBodies.length;
    const out = await sandboxRun.execute({ cmd: "echo hi" }, chat({ sandboxRepo: "proj-a" }, "http://127.0.0.1:1"));
    expect(out).toMatch(/git-scope signer \(claw-auth\) could not be reached/);
    expect(k8s.claimBodies.length).toBe(before);
  });
});

describe("sandbox-repo-setup", () => {
  const setup = (ctx: ToolExecutionContext, profileKey: string) =>
    sandboxRepoSetup.execute({ repoUrl: REPO_URL, profile: profileKey, write: true, branchName: "feat/x" }, ctx);

  it("profile A then A in one chat: one claim, reused", async () => {
    const ctx = chat();
    const before = k8s.claimBodies.length;
    const first = JSON.parse(await setup(ctx, "proj-a"));
    const second = JSON.parse(await setup(ctx, "proj-a"));
    expect(second).toMatchObject({ sessionId: first.sessionId, reused: true });
    const claims = claimsSince(before);
    expect(claims).toHaveLength(1);
    expectVerifiedList(claims[0]!, "proj-a");
    expect(second.log.join("\n")).toContain("Checked out feat/x on existing session.");
  }, 30_000);

  it("profile A then B on the same template: two claims, each with its own list", async () => {
    const ctx = chat();
    const before = k8s.claimBodies.length;
    const a = JSON.parse(await setup(ctx, "proj-a"));
    const b = JSON.parse(await setup(ctx, "proj-b"));
    expect(b.sessionId).not.toBe(a.sessionId);
    expect(b.reused).toBeUndefined();
    const claims = claimsSince(before);
    expect(claims.map((c) => c.spec.sandboxTemplateRef.name)).toEqual(["test-tpl", "test-tpl"]);
    expectVerifiedList(claims[0]!, "proj-a");
    expectVerifiedList(claims[1]!, "proj-b");
    expect(b.log.join("\n")).toContain("was created for another profile");
  }, 30_000);

  it("concurrent setups: A + A coalesce onto one claim, A + B get one claim each", async () => {
    const same = chat();
    let before = k8s.claimBodies.length;
    const [a1, a2] = (await Promise.all([setup(same, "proj-a"), setup(same, "proj-a")])).map((r) => JSON.parse(r));
    expect(a1.sessionId).toBe(a2.sessionId);
    expect(claimsSince(before)).toHaveLength(1);

    const mixed = chat();
    before = k8s.claimBodies.length;
    const [a, b] = (await Promise.all([setup(mixed, "proj-a"), setup(mixed, "proj-b")])).map((r) => JSON.parse(r));
    expect(a.sessionId).not.toBe(b.sessionId);
    const profiles = claimsSince(before).map((c) => {
      const payload = c.metadata.annotations![ANNOTATION]!.split(".")[1]!;
      return (JSON.parse(Buffer.from(payload, "base64url").toString()) as { profile: string }).profile;
    });
    expect(profiles.sort()).toEqual(["proj-a", "proj-b"]);
  }, 30_000);

  it("no-repo profile: gets a list too", async () => {
    const before = k8s.claimBodies.length;
    const out = JSON.parse(await sandboxRepoSetup.execute({}, chat({ sandboxRepo: "browser-test" })));
    expect(out.status).toBe("ready");
    expectVerifiedList(claimsSince(before)[0]!, "browser-test");
  });

  it("signer down: error names the signer, no claim, no read-only fallback", async () => {
    const before = k8s.claimBodies.length;
    const out = await setup(chat({}, "http://127.0.0.1:1"), "proj-a");
    expect(out).toMatch(/^Error: The git-scope signer \(claw-auth\) could not be reached/);
    expect(k8s.claimBodies.length).toBe(before);
  });

  it("fresh sandbox, fetch refused: clear error with git's last stderr line, redacted", async () => {
    router.refuseFetch = {
      exitCode: 128,
      stderr:
        "remote: this repository is not on this sandbox's list\n" +
        "fatal: unable to access 'https://x-access-token:ghp_abcdefghijklmnopqrstuvwxyz0123456789@example.test/acme/app.git/': The requested URL returned error: 403\n",
    };
    const out = await setup(chat(), "proj-a");
    expect(out).toMatch(/^Error: The repository example\.test\/acme\/app could not be fetched: git exited 128/);
    expect(out).toContain("The requested URL returned error: 403");
    expect(out).not.toContain("ghp_abcdefghij");
    expect(out).not.toContain("Checked out");
  }, 30_000);

  it("reused sandbox, fetch refused: clear error instead of 'Checked out'", async () => {
    const ctx = chat();
    const first = JSON.parse(await setup(ctx, "proj-a"));
    expect(first.sessionId).toBeTypeOf("string");
    router.refuseFetch = { exitCode: 1, stderr: "fatal: could not read from remote repository.\n" };
    const out = await setup(ctx, "proj-a");
    expect(out).toBe(
      "Error: The repository example.test/acme/app could not be fetched: git exited 1 while fetching/checking out feat/x " +
        `(fatal: could not read from remote repository.). The sandbox may not have access to this repository. Sandbox ${first.sessionId} was NOT set up on feat/x.`,
    );
  }, 30_000);

  it("aux repo fetch refused: error names the aux repo; exit 0 works", async () => {
    const auxSetup = (ctx: ToolExecutionContext) =>
      sandboxRepoSetup.execute({ repoName: "proj-aux", write: true, branchName: "feat/y" }, ctx);
    const ok = JSON.parse(await auxSetup(chat()));
    expect(ok.log.join("\n")).toContain("Aux lib: on main");
    router.refuseFetch = { exitCode: 128, stderr: "fatal: repository not allowed\n", match: "/workspace/lib" };
    const out = await auxSetup(chat());
    expect(out).toMatch(/^Error: The auxiliary repository lib could not be fetched: git exited 128 while fetching\/checking out main \(fatal: repository not allowed\)/);
  }, 30_000);

  it("sbx-git: the shared read-only sandbox gets the sbx-git list", async () => {
    const before = k8s.claimBodies.length;
    const out = await sandboxRepoSetup.execute({ repoName: "proj-a" }, chat({ eventType: "automation" }));
    expect(out).not.toMatch(/^Error/);
    const claims = claimsSince(before);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.spec.sandboxTemplateRef.name).toBe(SBX_GIT.template);
    expectVerifiedList(claims[0]!, SBX_GIT.profileKey);
  });
});
