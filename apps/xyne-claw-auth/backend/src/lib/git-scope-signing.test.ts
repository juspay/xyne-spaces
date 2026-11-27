import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REPO_CONFIGS,
  buildEffectiveRepoConfigs,
  verifyGitScope,
  type RepoConfigOverride,
  type RepoSetupConfig,
} from "xyne-claw-shared";

const state = vi.hoisted(() => ({ config: { clawGitScopePrivateKey: "", clawGitScopeKeyId: "" } }));
vi.mock("../config.js", () => ({ CONFIG: state.config }));
vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("./spaces-db.js", () => ({ getWorkspaceIdForUser: vi.fn() }));
vi.mock("../repositories/index.js", () => ({ sandboxRepoConfigRepository: {} }));

const {
  decideGitScope,
  gitScopeSigningKey,
  parseGitScopeRequest,
} = await import("./git-scope-signing.js");

const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const KEY = { privateKeyPem: privatePem, kid: "git-scope-test" };
const NOW = 1_800_000_000;

const profile = (slug: string, repoUrl: string | undefined, template = "ws-template", aux: string[] = []): RepoSetupConfig =>
  ({
    slug,
    name: slug,
    description: "",
    ...(repoUrl ? { repoUrl } : {}),
    defaultBranch: "main",
    workDir: "/workspace/x",
    template,
    steps: [],
    ...(aux.length ? { auxRepos: aux.map((url, i) => ({ name: `aux${i}`, url, defaultBranch: "main", workDir: `/w/${i}` })) } : {}),
  }) as RepoSetupConfig;

const OVERRIDES: RepoConfigOverride[] = [
  { key: "alpha", workspaceId: "ws-a", enabled: true, config: profile("alpha", "https://github.com/acme/alpha.git", "ws-template", ["git@github.com:acme/shared-lib.git"]) },
  { key: "alpha-off", workspaceId: "ws-a", enabled: false, config: profile("alpha-off", "https://github.com/acme/off.git") },
  { key: "beta", workspaceId: "ws-b", enabled: true, config: profile("beta", "https://github.com/acme/beta.git") },
  { key: "orphan", workspaceId: null, enabled: true, config: profile("orphan", "https://github.com/acme/orphan.git") },
  { key: "broken", workspaceId: "ws-a", enabled: true, config: profile("broken", "s3cret-token-not-a-url") },
];
const configsFor = (ws: string | null, extra: RepoConfigOverride[] = []) =>
  buildEffectiveRepoConfigs([...OVERRIDES, ...extra], DEFAULT_REPO_CONFIGS, ws);

const request = (over: Record<string, unknown> = {}) => ({
  profile: "alpha",
  claimName: "sbx-claim-1",
  namespace: "xyne-apps",
  template: "ws-template",
  endTime: NOW + 3600,
  ...over,
});
const parsed = (over: Record<string, unknown> = {}) => {
  const result = parseGitScopeRequest(request(over), NOW);
  if (!result.ok) throw new Error(result.error);
  return result.request;
};
const decide = (over: Record<string, unknown>, run: { workspaceId: string | null }, extra: RepoConfigOverride[] = []) =>
  decideGitScope({
    request: parsed(over),
    run: { workspaceId: run.workspaceId },
    configs: configsFor(run.workspaceId, extra),
    key: KEY,
    now: NOW,
  });

describe("parseGitScopeRequest", () => {
  it("accepts a well-formed request", () => {
    expect(parseGitScopeRequest(request(), NOW)).toEqual({ ok: true, request: request() });
  });

  it.each([
    ["not an object", null],
    ["an array", []],
    ["a string", "alpha"],
  ])("refuses a body that is %s", (_why, body) => {
    expect(parseGitScopeRequest(body, NOW).ok).toBe(false);
  });

  it.each<[string, Record<string, unknown>]>([
    ["an extra member (a body cannot name the workspace)", { workspaceId: "ws-b" }],
    ["an extra member (sessionId)", { sessionId: "other" }],
    ["a bad profile key", { profile: "Alpha!" }],
    ["a profile that is not a string", { profile: 5 }],
    ["an upper-case claim name", { claimName: "Sbx-Claim" }],
    ["a claim name with a slash", { claimName: "a/b" }],
    ["a claim name over 253 characters", { claimName: "a".repeat(254) }],
    ["a claim name with a leading dash", { claimName: "-a" }],
    ["a namespace with a dot", { namespace: "xyne.apps" }],
    ["a namespace over 63 characters", { namespace: "a".repeat(64) }],
    ["an empty template", { template: "" }],
    ["a template with spaces", { template: "ws template" }],
    ["a fractional endTime", { endTime: NOW + 0.5 }],
    ["an endTime as a string", { endTime: String(NOW + 3600) }],
    ["an endTime in the past", { endTime: NOW - 1 }],
    ["an endTime equal to now", { endTime: NOW }],
  ])("refuses %s", (_why, over) => {
    expect(parseGitScopeRequest(request(over), NOW).ok).toBe(false);
  });

  it("refuses a missing member", () => {
    const { template: _t, ...rest } = request();
    expect(parseGitScopeRequest(rest, NOW).ok).toBe(false);
  });

});

describe("decideGitScope", () => {
  it("signs a token that verifies with the public key and matches the claim", () => {
    const decision = decide({}, { workspaceId: "ws-a" });
    if (!decision.ok) throw new Error(decision.error);
    const verified = verifyGitScope(decision.token, {
      keys: { "git-scope-test": publicPem },
      expected: { claim: "sbx-claim-1", namespace: "xyne-apps", template: "ws-template" },
      now: NOW + 10,
    });
    if (!verified.ok) throw new Error(verified.reason);
    expect({ ...verified.scope }).toEqual({
      v: 1,
      claim: "sbx-claim-1",
      ns: "xyne-apps",
      tpl: "ws-template",
      profile: "alpha",
      iat: NOW,
      exp: NOW + 3600,
      repos: [
        { repo: "github.com/acme/alpha", access: "rw" },
        { repo: "github.com/acme/shared-lib", access: "rw" },
      ],
    });
    // Another claim, namespace or key does not accept it.
    const keys = { "git-scope-test": publicPem };
    expect(verifyGitScope(decision.token, { keys, expected: { claim: "other", namespace: "xyne-apps" }, now: NOW + 10 })).toMatchObject({ ok: false, reason: "not-for-this-claim" });
    expect(verifyGitScope(decision.token, { keys, expected: { claim: "sbx-claim-1", namespace: "other" }, now: NOW + 10 })).toMatchObject({ ok: false, reason: "wrong-namespace" });
    const stranger = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(verifyGitScope(decision.token, { keys: { "git-scope-test": stranger }, expected: { claim: "sbx-claim-1", namespace: "xyne-apps" }, now: NOW + 10 })).toMatchObject({ ok: false, reason: "bad-signature" });
    expect(verifyGitScope(decision.token, { keys, expected: { claim: "sbx-claim-1", namespace: "xyne-apps" }, now: NOW + 3600 })).toMatchObject({ ok: false, reason: "expired" });
  });

  it("workspace isolation: workspace A cannot get workspace B's profile, and B cannot get A's", () => {
    expect(decide({ profile: "beta" }, { workspaceId: "ws-a" })).toMatchObject({ ok: false, status: 404 });
    expect(decide({ profile: "alpha" }, { workspaceId: "ws-b" })).toMatchObject({ ok: false, status: 404 });
    expect(decide({ profile: "beta" }, { workspaceId: "ws-b" })).toMatchObject({ ok: true });
  });

  it("a run with no workspace gets built-ins only", () => {
    expect(decide({ profile: "alpha" }, { workspaceId: null })).toMatchObject({ ok: false, status: 404 });
    expect(decide({ profile: "browser", template: DEFAULT_REPO_CONFIGS["browser"]!.template }, { workspaceId: null })).toMatchObject({ ok: true });
  });

  it("an agent's pin does not limit signing: any profile the run's workspace may use is signed", () => {
    expect(decide({ profile: "alpha" }, { workspaceId: "ws-a" })).toMatchObject({ ok: true });
  });

  it("built-in profiles are allowed for any workspace", () => {
    const template = DEFAULT_REPO_CONFIGS["xyne-spaces"]!.template;
    for (const workspaceId of ["ws-a", "ws-b", "ws-unknown", null]) {
      const decision = decide({ profile: "xyne-spaces", template }, { workspaceId });
      expect(decision).toMatchObject({ ok: true, repoCount: 1 });
    }
    // A profile with no repositories signs an empty list.
    expect(decide({ profile: "browser", template: DEFAULT_REPO_CONFIGS["browser"]!.template }, { workspaceId: "ws-a" })).toMatchObject({ ok: true, repoCount: 0 });
  });

  it("refuses a disabled profile, an unknown profile and an unowned row with 404", () => {
    expect(decide({ profile: "alpha-off" }, { workspaceId: "ws-a" })).toMatchObject({ ok: false, status: 404 });
    expect(decide({ profile: "nope" }, { workspaceId: "ws-a" })).toMatchObject({ ok: false, status: 404 });
    expect(decide({ profile: "orphan" }, { workspaceId: "ws-a" })).toMatchObject({ ok: false, status: 404 });
    // A disabled built-in is gone too.
    const off: RepoConfigOverride = { key: "browser", enabled: false, config: DEFAULT_REPO_CONFIGS["browser"]! };
    expect(decide({ profile: "browser", template: DEFAULT_REPO_CONFIGS["browser"]!.template }, { workspaceId: "ws-a" }, [off])).toMatchObject({ ok: false, status: 404 });
  });

  it("sbx-git is refused until a profile with that key exists, then signed", () => {
    expect(decide({ profile: "sbx-git" }, { workspaceId: "ws-a" })).toMatchObject({ ok: false, status: 404 });
    const sbx: RepoConfigOverride = { key: "sbx-git", workspaceId: "ws-a", enabled: true, config: profile("sbx-git", "https://github.com/acme/alpha.git") };
    expect(decide({ profile: "sbx-git" }, { workspaceId: "ws-a" }, [sbx])).toMatchObject({ ok: true });
  });


  it("template family: base and rotation copies pass, anything else is refused", () => {
    const base = DEFAULT_REPO_CONFIGS["xyne-spaces"]!.template;
    expect(base).toBe("agent-workspace-gvisor-template");
    for (const template of [base, `${base}-a`, `${base}-f`]) {
      expect(decide({ profile: "xyne-spaces", template }, { workspaceId: "ws-a" })).toMatchObject({ ok: true });
    }
    for (const template of [`${base}-z`, "euler-workspace-template-a", "kata-workspace-template"]) {
      expect(decide({ profile: "xyne-spaces", template }, { workspaceId: "ws-a" })).toMatchObject({ ok: false, status: 400 });
    }
    expect(decide({ profile: "alpha", template: "other-template" }, { workspaceId: "ws-a" })).toMatchObject({ ok: false, status: 400 });
  });

  it("a stored profile whose address cannot be carried is a server error, never a silently shorter list", () => {
    const decision = decide({ profile: "broken" }, { workspaceId: "ws-a" });
    expect(decision).toMatchObject({ ok: false, status: 500 });
    if (!decision.ok) expect(decision.error).not.toContain("s3cret");
  });
});

describe("gitScopeSigningKey", () => {
  it("is null until both the key and its id are set, and for a key that is not P-256", () => {
    state.config.clawGitScopePrivateKey = "";
    state.config.clawGitScopeKeyId = "";
    expect(gitScopeSigningKey()).toBeNull();
    state.config.clawGitScopePrivateKey = privatePem;
    expect(gitScopeSigningKey()).toBeNull();
    state.config.clawGitScopeKeyId = "git-scope-test";
    expect(gitScopeSigningKey()).toEqual(KEY);
    state.config.clawGitScopePrivateKey = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(gitScopeSigningKey()).toBeNull();
    state.config.clawGitScopePrivateKey = "not a pem";
    expect(gitScopeSigningKey()).toBeNull();
  });
});
