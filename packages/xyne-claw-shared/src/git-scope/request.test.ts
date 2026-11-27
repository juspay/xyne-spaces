import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  GIT_GATEWAY_MAX_TARGET_LENGTH,
  GIT_GATEWAY_REFUSALS,
  decideGitRequest,
  gitScopeReposForProfile,
  parseGitGatewayRequest,
  signGitScope,
  verifyGitScope,
  type GitGatewayHostMap,
  type GitGatewayOp,
  type GitGatewayRefusal,
  type GitGatewayRequest,
  type GitRequestDecision,
  type GitScopePayload,
  type GitScopeRepo,
  type VerifiedGitScope,
} from "./index.js";

// One request per refusal reason, plus the four allowed forms.
const REQUESTS: {
  method: string;
  target: string;
  hostMap?: GitGatewayHostMap;
  result: { ok: true; host: string; repo: string; op: GitGatewayOp } | { ok: false; reason: GitGatewayRefusal };
}[] = [
  { method: "GET", target: "/github.com/example-org/app.git/info/refs?service=git-upload-pack", result: {"ok": true, "host": "github.com", "repo": "github.com/example-org/app", "op": "fetch"} },
  { method: "POST", target: "/github.com/example-org/app.git/git-upload-pack", result: {"ok": true, "host": "github.com", "repo": "github.com/example-org/app", "op": "fetch"} },
  { method: "GET", target: "/github.com/example-org/app.git/info/refs?service=git-receive-pack", result: {"ok": true, "host": "github.com", "repo": "github.com/example-org/app", "op": "push"} },
  { method: "POST", target: "/github.com/example-org/app.git/git-receive-pack", result: {"ok": true, "host": "github.com", "repo": "github.com/example-org/app", "op": "push"} },
  { method: "GET", target: "/bb/scm/proj/service.git/info/refs?service=git-upload-pack", result: {"ok": false, "reason": "invalid-host"}, hostMap: {"bb": "https://bitbucket.example.net"} },
  { method: "HEAD", target: "/github.com/example-org/app.git/info/refs?service=git-upload-pack", result: {"ok": false, "reason": "method-not-allowed"} },
  { method: "GET", target: "/", result: {"ok": false, "reason": "empty-segment"} },
  { method: "GET", target: "/github.com/example-org/app.git", result: {"ok": false, "reason": "not-a-git-address"} },
  { method: "GET", target: "github.com/example-org/app.git/info/refs?service=git-upload-pack", result: {"ok": false, "reason": "invalid-target"} },
  { method: "GET", target: "/github.com/example-org/app.git/info/refs", result: {"ok": false, "reason": "missing-service"} },
  { method: "GET", target: "/github.com/example-org/app.git/info/refs?", result: {"ok": false, "reason": "unexpected-query"} },
  { method: "GET", target: "/github.com/example-org/app.git/info/refs?service=", result: {"ok": false, "reason": "unknown-service"} },
  { method: "GET", target: "/github.com/example-org%2fapp.git/info/refs?service=git-upload-pack", result: {"ok": false, "reason": "encoded-slash"} },
  { method: "GET", target: "/github.com/example-org/%2e%2e/other/app.git/info/refs?service=git-upload-pack", result: {"ok": false, "reason": "encoded-dot"} },
  { method: "GET", target: "/github.com/example-org/%252e%252e/app.git/info/refs?service=git-upload-pack", result: {"ok": false, "reason": "encoded-character"} },
  { method: "GET", target: "/github.com/example-org/../other-org/app.git/info/refs?service=git-upload-pack", result: {"ok": false, "reason": "dot-segment"} },
  { method: "GET", target: "/github.com/example-org/..git/info/refs?service=git-upload-pack", result: {"ok": false, "reason": "unsupported-path-form"} },
  { method: "GET", target: "/github.com/example-org\\app.git/info/refs?service=git-upload-pack", result: {"ok": false, "reason": "backslash"} },
  { method: "GET", target: "/github.com/example-org/app\u0000.git/info/refs?service=git-upload-pack", result: {"ok": false, "reason": "control-character"} },
  { method: "GET", target: "/github.com/example-org/app name.git/info/refs?service=git-upload-pack", result: {"ok": false, "reason": "invalid-character"} },
  { method: "GET", target: "/info/refs?service=git-upload-pack", result: {"ok": false, "reason": "too-few-segments"} },
  { method: "GET", target: "/github.com/example-org/app.GIT/info/refs?service=git-upload-pack", result: {"ok": false, "reason": "invalid-git-suffix"} },
  { method: "GET", target: "/github.com/example-org/" + "a".repeat(1024) + ".git/info/refs?service=git-upload-pack", result: {"ok": false, "reason": "target-too-long"} },
];

const UPLOAD = "?service=git-upload-pack";
const RECEIVE = "?service=git-receive-pack";

/** The four requests git makes for a repository at `/<host>/<path>`. */
const fourAddresses = (base: string): [string, string, GitGatewayOp][] => [
  ["GET", `${base}/info/refs${UPLOAD}`, "fetch"],
  ["POST", `${base}/git-upload-pack`, "fetch"],
  ["GET", `${base}/info/refs${RECEIVE}`, "push"],
  ["POST", `${base}/git-receive-pack`, "push"],
];

function parsed(method: string, target: string, hostMap?: GitGatewayHostMap): GitGatewayRequest {
  const result = parseGitGatewayRequest(method, target, hostMap);
  if (!result.ok) throw new Error(`${method} ${target} was refused: ${result.reason}`);
  return result.request;
}
function refusal(method: unknown, target: unknown, hostMap?: GitGatewayHostMap): GitGatewayRefusal | "accepted" {
  const result = parseGitGatewayRequest(method, target, hostMap);
  return result.ok ? "accepted" : result.reason;
}

const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const NOW = 1_790_000_000;
/** A verified list, the only thing decideGitRequest takes. */
function scopeOf(repos: readonly GitScopeRepo[]): VerifiedGitScope {
  const payload: GitScopePayload = { v: 1, claim: "sbx-7f3a9c", ns: "sandboxes", tpl: "agent-workspace-template", profile: "example-profile", iat: NOW - 10, exp: NOW + 3600, repos };
  const token = signGitScope(payload, keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "signer-1");
  const result = verifyGitScope(token, {
    keys: { "signer-1": keys.publicKey.export({ type: "spki", format: "pem" }).toString() },
    now: NOW,
    expected: { claim: "sbx-7f3a9c", namespace: "sandboxes" },
  });
  if (!result.ok) throw new Error(result.reason);
  return result.scope;
}

describe("parseGitGatewayRequest", () => {
  it("understands git's four smart-HTTP addresses", () => {
    for (const [method, target, op] of fourAddresses("/github.com/example-org/app.git")) {
      expect(parseGitGatewayRequest(method, target)).toEqual({ ok: true, request: { host: "github.com", repo: "github.com/example-org/app", op } });
    }
  });

  it("returns host and repo so that repo is host + '/' + path", () => {
    const request = parsed("GET", `/ssh.bitbucket.example.net/scm/PROJ/Service.git/info/refs${UPLOAD}`);
    expect(request).toEqual({ host: "bitbucket.example.net", repo: "bitbucket.example.net/proj/service", op: "fetch" });
    expect(request.repo.startsWith(`${request.host}/`)).toBe(true);
  });

  it("renames the host segment through the host map, and leaves other hosts alone", () => {
    const hostMap = { bb: "bitbucket.example.net", gh: "GitHub.com" };
    expect(parsed("GET", `/bb/scm/proj/service.git/info/refs${UPLOAD}`, hostMap).repo).toBe("bitbucket.example.net/proj/service");
    expect(parsed("GET", `/BB/scm/proj/service.git/info/refs${UPLOAD}`, hostMap).repo).toBe("bitbucket.example.net/proj/service");
    expect(parsed("POST", "/gh/example-org/app.git/git-receive-pack", hostMap)).toEqual({ host: "github.com", repo: "github.com/example-org/app", op: "push" });
    expect(parsed("GET", `/gitlab.example.com/a/b.git/info/refs${UPLOAD}`, hostMap).repo).toBe("gitlab.example.com/a/b");
    // without the map the alias is just a host nobody has a list entry for
    expect(parsed("GET", `/bb/scm/proj/service.git/info/refs${UPLOAD}`).repo).toBe("bb/proj/service");
    // names every object has are not map entries
    for (const host of ["constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(parsed("GET", `/${host}/a/b.git/info/refs${UPLOAD}`, hostMap).host).toBe(host.toLowerCase());
    }
    expect(refusal("GET", `/bb/a/b.git/info/refs${UPLOAD}`, { bb: 7 } as unknown as GitGatewayHostMap)).toBe("invalid-host");
    // a map value must be a bare host: nothing that lower-casing or the address normaliser would turn into one
    for (const value of ["https://bitbucket.example.net", "bitbucket.example.net:7999", "git@bitbucket.example.net", "bitbucket.example.net/scm", "bitbucKet.example.net", " bitbucket.example.net", ""]) {
      expect(refusal("GET", `/bb/a/b.git/info/refs${UPLOAD}`, { bb: value }), JSON.stringify(value)).toBe("invalid-host");
    }
  });

  it("refuses what is not a string", () => {
    for (const method of [undefined, null, 1, ["GET"], {}]) expect(refusal(method, "/github.com/example-org/app.git/git-upload-pack")).toBe("method-not-allowed");
    for (const target of [undefined, null, 1, ["/a/b/c/git-upload-pack"], {}]) expect(refusal("POST", target)).toBe("invalid-target");
  });

  it("accepts a target of exactly the length limit and refuses one character more", () => {
    const fixed = `/github.com/example-org/.git/info/refs${UPLOAD}`.length;
    const atLimit = `/github.com/example-org/${"a".repeat(GIT_GATEWAY_MAX_TARGET_LENGTH - fixed)}.git/info/refs${UPLOAD}`;
    expect(atLimit).toHaveLength(GIT_GATEWAY_MAX_TARGET_LENGTH);
    expect(refusal("GET", atLimit)).not.toBe("target-too-long");
    expect(refusal("GET", atLimit.replace("/a", "/aa"))).toBe("target-too-long");
  });
});

describe("one repository, every address form, one name", () => {
  const cases = [
    {
      repo: "bitbucket.example.net/proj/service",
      profileAddresses: [
        "ssh://git@bitbucket.example.net/proj/service.git",
        "ssh://git@bitbucket.example.net/proj/service",
        "ssh://git@ssh.bitbucket.example.net/proj/service.git",
        "ssh://git@ssh.bitbucket.example.net:7999/proj/service.git",
        "ssh://git@ssh.bitbucket.example.net:7999/PROJ/Service.git",
        "git@bitbucket.example.net:proj/service.git",
        "git@bitbucket.example.net:proj/service",
        "git@ssh.bitbucket.example.net:PROJ/service.git",
        "https://bitbucket.example.net/proj/service",
        "https://bitbucket.example.net/proj/service.git",
        "https://bitbucket.example.net/proj/service/",
        "HTTPS://BITBUCKET.EXAMPLE.NET/PROJ/SERVICE.git",
        "https://user@bitbucket.example.net/proj/service.git",
        "https://bitbucket.example.net/scm/proj/service.git",
        "https://bitbucket.example.net/scm/PROJ/service",
        "https://bitbucket.example.net/projects/PROJ/repos/service/browse",
        "https://bitbucket.example.net/projects/proj/repos/service",
      ],
      hosts: ["bitbucket.example.net", "BitBucket.Example.NET", "ssh.bitbucket.example.net", "SSH.bitbucket.example.net"],
      paths: ["proj/service", "proj/service.git", "PROJ/Service.git", "PROJ/SERVICE", "scm/proj/service.git", "scm/PROJ/service", "SCM/proj/service.git"],
    },
    {
      repo: "bitbucket.example.net/~jdoe/tools",
      profileAddresses: [
        "ssh://git@ssh.bitbucket.example.net:7999/~jdoe/tools.git",
        "git@ssh.bitbucket.example.net:~jdoe/tools.git",
        "https://bitbucket.example.net/scm/~jdoe/tools.git",
        "https://bitbucket.example.net/scm/~JDOE/Tools.git",
        "https://bitbucket.example.net/~jdoe/tools",
        "https://bitbucket.example.net/projects/~JDOE/repos/tools/browse",
      ],
      hosts: ["bitbucket.example.net", "ssh.bitbucket.example.net"],
      paths: ["scm/~jdoe/tools.git", "scm/~JDOE/tools.git", "scm/~jdoe/tools", "~jdoe/tools.git", "~JDOE/Tools"],
    },
    {
      repo: "github.com/example-org/app",
      profileAddresses: [
        "ssh://git@github.com/example-org/app.git",
        "git@github.com:example-org/app.git",
        "https://github.com/example-org/app",
        "https://github.com/example-org/app.git",
        "https://github.com/Example-Org/App",
        "https://www.github.com/example-org/app",
        "git+ssh://git@github.com/example-org/app.git",
      ],
      hosts: ["github.com", "GITHUB.COM", "www.github.com"],
      paths: ["example-org/app", "example-org/app.git", "Example-Org/App.git", "EXAMPLE-ORG/APP"],
    },
  ];

  it.each(cases.map((group) => [group.repo, group] as const))("%s", (_name, { repo, profileAddresses, hosts, paths }) => {
    // signer side: every address a profile could hold
    const fromProfiles = profileAddresses.map((address) => gitScopeReposForProfile({ repoUrl: address }));
    for (const [i, list] of fromProfiles.entries()) expect(list, profileAddresses[i]).toEqual([repo]);
    expect(gitScopeReposForProfile({ auxRepos: profileAddresses.map((url, i) => ({ name: `aux-${i}`, url })) })).toEqual([repo]);

    // gateway side: every address git could be pointed at, for all four requests
    const fromGateway: string[] = [];
    for (const host of hosts) {
      for (const path of paths) {
        for (const [method, target] of fourAddresses(`/${host}/${path}`)) fromGateway.push(parsed(method, target).repo);
      }
    }
    expect(fromGateway).toHaveLength(hosts.length * paths.length * 4);
    expect(new Set([...fromProfiles.flat(), ...fromGateway])).toEqual(new Set([repo]));

    // and the two sides meet: a list built from any profile form allows a request in any gateway form
    for (const address of profileAddresses) {
      const scope = scopeOf(gitScopeReposForProfile({ repoUrl: address }).map((entry) => ({ repo: entry, access: "rw" as const })));
      for (const [method, target] of fourAddresses(`/${hosts[hosts.length - 1]}/${paths[paths.length - 1]}`)) {
        expect(decideGitRequest(scope, parsed(method, target))).toEqual({ allowed: true, access: "rw" });
      }
    }
  });

  it("Bitbucket's web address is a form for the profile only: git cannot be pointed at it", () => {
    expect(gitScopeReposForProfile({ repoUrl: "https://bitbucket.example.net/projects/PROJ/repos/service/browse" })).toEqual(["bitbucket.example.net/proj/service"]);
    for (const [method, target] of fourAddresses("/bitbucket.example.net/projects/PROJ/repos/service")) {
      expect(refusal(method, target)).toBe("unsupported-path-form");
    }
  });
});

describe("two different repositories never get one name", () => {
  const hosts = ["github.com", "gitlab.example.com", "bitbucket.example.net", "github.com.example.net", "evil-github.com", "git.github.com", "hub.com"];
  const paths = [
    "example-org/app",
    "example-org/app2",
    "example-org/ap",
    "example-org/app-",
    "example-org/app.js",
    "example-org/app_",
    "example-org/other",
    "example-org2/app",
    "example/org-app",
    "other-org/app",
    "app/example-org",
    "example-org/app/sub",
    "example-org/app/app",
    "group/example-org/app",
    "~example-org/app",
    "example-org/~app",
    "example-org/.app",
    "example-org/app.github",
  ];
  const repositories = hosts.flatMap((host) => paths.map((path) => ({ host, path })));
  const fromProfile = repositories.map(({ host, path }) => gitScopeReposForProfile({ repoUrl: `https://${host}/${path}.git` })[0]);
  const fromSsh = repositories.map(({ host, path }) => gitScopeReposForProfile({ repoUrl: `git@${host}:${path}.git` })[0]);
  const fromGateway = repositories.map(({ host, path }) => parsed("GET", `/${host}/${path}.git/info/refs${UPLOAD}`).repo);

  it("each repository has one name on both sides", () => {
    expect(fromProfile).toEqual(fromGateway);
    expect(fromSsh).toEqual(fromGateway);
  });

  it("and no two of them share it", () => {
    expect(new Set(fromGateway).size).toBe(repositories.length);
    expect(repositories.length).toBe(hosts.length * paths.length);
  });

  it("so a list for one repository allows no request for any other", () => {
    let refusedCount = 0;
    for (const [granted, grantedRepo] of fromProfile.entries()) {
      if (grantedRepo === undefined) throw new Error("missing entry");
      const scope = scopeOf([{ repo: grantedRepo, access: "rw" }]);
      for (const [asked, { host, path }] of repositories.entries()) {
        for (const [method, target] of fourAddresses(`/${host}/${path}.git`)) {
          const decision = decideGitRequest(scope, parsed(method, target));
          if (asked === granted) expect(decision).toEqual({ allowed: true, access: "rw" });
          else {
            expect(decision).toEqual({ allowed: false, reason: "repo-not-on-list" });
            refusedCount++;
          }
        }
      }
    }
    expect(refusedCount).toBe(repositories.length * (repositories.length - 1) * 4);
  });
});

describe("hostile and odd request addresses", () => {
  const refusedVectors = REQUESTS.filter((vector) => !vector.result.ok);

  it("the table has a case for every refusal reason", () => {
    const reasons = new Set(refusedVectors.map((vector) => (vector.result.ok ? "" : vector.result.reason)));
    expect([...reasons].sort()).toEqual([...GIT_GATEWAY_REFUSALS].sort());
  });

  it.each(REQUESTS.map((vector) => [vector.method, JSON.stringify(vector.target.length > 120 ? `${vector.target.slice(0, 60)}...(${vector.target.length} characters)` : vector.target), vector.result.ok ? `${vector.result.op} ${vector.result.repo}` : vector.result.reason, vector] as const))(
    "%s %s -> %s",
    (_method, _target, _expected, vector) => {
      const result = parseGitGatewayRequest(vector.method, vector.target, vector.hostMap);
      if (vector.result.ok) expect(result).toEqual({ ok: true, request: { host: vector.result.host, repo: vector.result.repo, op: vector.result.op } });
      else expect(result).toEqual({ ok: false, reason: vector.result.reason });
    },
  );

  it("refuses every byte value that has no place in an address, wherever it is put", () => {
    const base = "/github.com/example-org/app.git/info/refs";
    const allowed = /^[A-Za-z0-9._~\/-]$/;
    let tried = 0;
    for (let value = 0; value < 256; value++) {
      const character = String.fromCharCode(value);
      if (allowed.test(character) || character === "?") continue;
      for (let position = 1; position <= base.length; position++) {
        const target = `${base.slice(0, position)}${character}${base.slice(position)}${UPLOAD}`;
        expect(refusal("GET", target), JSON.stringify(target)).not.toBe("accepted");
        tried++;
      }
    }
    expect(tried).toBeGreaterThan(7000);
  });

  it("never accepts an address that names another repository by a detour", () => {
    const granted = "github.com/example-org/app";
    const detours = [
      "/github.com/example-org/app/../secret.git",
      "/github.com/example-org/app/..%2fsecret.git",
      "/github.com/example-org/app%2f..%2fsecret.git",
      "/github.com/example-org/app/%2e%2e/secret.git",
      "/github.com/example-org/app.git/../secret.git",
      "/github.com/example-org/app\\..\\secret.git",
      "/github.com/example-org/app//secret.git",
      "/github.com/example-org/app/./secret.git",
      "/github.com/example-org/app;/secret.git",
      "/github.com/example-org/app%00/secret.git",
      "/github.com/example-org/app/tree/secret.git",
      "/github.com/example-org/app/blob/secret.git",
      "/github.com/example-org/app/src/secret.git",
      "/github.com/example-org/app/browse/secret.git",
      "/github.com/example-org/app/pull/secret.git",
      "/github.com/example-org/app/pulls/secret.git",
      "/github.com/example-org/app/-/secret.git",
      "/github.com/projects/example-org/repos/app/secret.git",
      "/github.com/scm/scm/example-org/app.git",
      "/github.com@evil.example/example-org/app.git",
      "/evil.example/github.com/example-org/app.git",
      "/github.com:443/example-org/app.git",
      "/github.com./example-org/app.git",
      "/github.com/example-org/app.git.git",
      "/github.com/example-org/app.GIT",
      "/github.com/example-org/app/.git",
    ];
    for (const detour of detours) {
      for (const [method, target] of fourAddresses(detour)) {
        const result = parseGitGatewayRequest(method, target);
        // Either the request is refused, or it is read as a repository that is plainly not the granted one.
        if (result.ok) expect(result.request.repo, target).not.toBe(granted);
      }
    }
    // The detours the address normaliser would shorten to the granted name are refused outright.
    for (const shortened of detours.filter((detour) => /\/(tree|blob|src|browse|pull|pulls|-)\/|projects\//.test(detour))) {
      for (const [method, target] of fourAddresses(shortened)) expect(refusal(method, target), target).toBe("unsupported-path-form");
    }
  });
});

describe("whatever is accepted lost nothing but letter case, .git, a leading scm/ and a leading ssh. or www.", () => {
  // A fixed sequence, so a failure can be repeated.
  function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hostPieces = ["github.com", "GitHub.com", "ssh.bitbucket.example.net", "www.example.com", "ssh.ssh.example.com", "example.com.", "bb", "scm", "projects", "10.0.0.5", "a_b.example", "-x.example", "[::1]", "example.com:443", "git@example.com", "", ".", ".."];
  const pathPieces = [
    "a", "b", "A", "example-org", "app", "App", "scm", "SCM", "projects", "repos", "tree", "blob", "src", "browse", "pull", "pulls", "-", "users", "~jdoe", "~JDOE",
    "app.git", "app.GIT", "app.git.git", ".git", "..git", ".", "..", "", "info", "refs", "git-upload-pack", "git-receive-pack", "HEAD", "objects",
    "%2e%2e", "%2f", "a%2fb", "a%20b", "a b", "a\\b", "a;b", "a@b", "a:b", "a?b", "a#b", "*", "é", "\u0000", "a\tb", "constructor", "__proto__",
  ];
  const endings = ["/info/refs", "/git-upload-pack", "/git-receive-pack", "/info/refs/", "/INFO/REFS", "/HEAD", "", "/info/lfs/objects/batch"];
  const queries = ["", UPLOAD, RECEIVE, "?service=git-upload-archive", `${UPLOAD}&x=1`, `${UPLOAD}${RECEIVE.replace("?", "&")}`, "?", "?x=1", `?x=1${UPLOAD.replace("?", "&")}`, "?service=", "?service=constructor"];
  const methods = ["GET", "POST", "HEAD", "PUT", "DELETE", "get"];

  it("holds for 50,000 addresses assembled from awkward pieces", () => {
    const next = random(20261127);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
    let accepted = 0;
    const reasons = new Set<string>();
    for (let i = 0; i < 50_000; i++) {
      // mostly well-formed, so that a good share is accepted and the invariant is exercised
      const wellFormed = next() < 0.5;
      const host = wellFormed ? pick(hostPieces.slice(0, 4)) : pick(hostPieces);
      const segments = Array.from({ length: 1 + Math.floor(next() * 5) }, () => (wellFormed ? pick(pathPieces.slice(0, 22)) : pick(pathPieces)));
      const method = wellFormed ? pick(methods.slice(0, 2)) : pick(methods);
      const ending = wellFormed ? pick(endings.slice(0, 3)) : pick(endings);
      const query = wellFormed ? (method === "GET" ? pick(queries.slice(1, 3)) : "") : pick(queries);
      const target = `/${host}/${segments.join("/")}${ending}${query}`;

      const result = parseGitGatewayRequest(method, target);
      if (!result.ok) {
        reasons.add(result.reason);
        continue;
      }
      accepted++;
      const { host: gotHost, repo, op } = result.request;

      // 1. nothing awkward got through
      expect(/[%\\\u0000-\u001f\u007f-￿]/.test(target), target).toBe(false);
      expect(segments.every((segment) => segment !== "" && segment !== "." && segment !== ".."), target).toBe(true);
      // 2. the request is one of the four
      const expectedOp = method === "GET" ? (query === UPLOAD ? "fetch" : query === RECEIVE ? "push" : "none") : ending === "/git-upload-pack" && query === "" ? "fetch" : ending === "/git-receive-pack" && query === "" ? "push" : "none";
      expect(op, target).toBe(expectedOp);
      expect(method === "GET" ? ending === "/info/refs" : method === "POST", target).toBe(true);
      // 3. the name is the address, minus only what is allowed to vary
      const lower = segments.map((segment) => segment.toLowerCase());
      const lastIndex = lower.length - 1;
      if (segments[lastIndex]?.endsWith(".git")) lower[lastIndex] = (lower[lastIndex] ?? "").slice(0, -4);
      if (lower[0] === "scm") lower.shift();
      const expectedHost = host.toLowerCase().replace(/^(ssh|www)\./, "");
      expect(gotHost, target).toBe(expectedHost);
      expect(repo, target).toBe(`${expectedHost}/${lower.join("/")}`);
      // 4. the name is a list entry's form, and reading its plain address gives it back
      expect(gitScopeReposForProfile({ repoUrl: `https://${repo}.git` }), target).toEqual([repo]);
      expect(parsed("POST", `/${repo}.git/git-upload-pack`).repo, target).toBe(repo);
    }
    // the mix really did exercise both outcomes
    if (process.env["GIT_SCOPE_TEST_REPORT"]) console.log(`[git-scope addresses] assembled: 50000; accepted: ${accepted}; refused: ${50_000 - accepted} for ${reasons.size} different reasons`);
    expect(accepted).toBeGreaterThan(2_000);
    expect(reasons.size).toBeGreaterThan(12);
  });
});

describe("decideGitRequest", () => {
  const scope = scopeOf([
    { repo: "bitbucket.example.net/~jdoe/tools", access: "r" },
    { repo: "github.com/example-org/app", access: "rw" },
  ]);

  it("allows fetch and push on an rw entry", () => {
    for (const [method, target] of fourAddresses("/github.com/example-org/app.git")) {
      expect(decideGitRequest(scope, parsed(method, target))).toEqual({ allowed: true, access: "rw" });
    }
  });

  it("allows fetch and refuses push on an r entry", () => {
    const base = "/bitbucket.example.net/scm/~jdoe/tools.git";
    expect(decideGitRequest(scope, parsed("GET", `${base}/info/refs${UPLOAD}`))).toEqual({ allowed: true, access: "r" });
    expect(decideGitRequest(scope, parsed("POST", `${base}/git-upload-pack`))).toEqual({ allowed: true, access: "r" });
    expect(decideGitRequest(scope, parsed("GET", `${base}/info/refs${RECEIVE}`))).toEqual({ allowed: false, reason: "fetch-only" });
    expect(decideGitRequest(scope, parsed("POST", `${base}/git-receive-pack`))).toEqual({ allowed: false, reason: "fetch-only" });
  });

  it("refuses a repository that is not on the list, for fetch and for push", () => {
    for (const [method, target] of fourAddresses("/github.com/example-org/other.git")) {
      expect(decideGitRequest(scope, parsed(method, target))).toEqual({ allowed: false, reason: "repo-not-on-list" });
    }
  });

  it("refuses everything when the list is empty", () => {
    const empty = scopeOf([]);
    for (const [method, target] of fourAddresses("/github.com/example-org/app.git")) {
      expect(decideGitRequest(empty, parsed(method, target))).toEqual({ allowed: false, reason: "repo-not-on-list" });
    }
  });

  it("matches the whole name only: no prefixes, no parents, no children, no patterns", () => {
    for (const repo of ["github.com/example-org", "github.com/example-org/ap", "github.com/example-org/app2", "github.com/example-org/app/sub", "github.com/example-org/*", "github.com/example-org/APP", "gitlab.example.com/example-org/app", ""]) {
      expect(decideGitRequest(scope, { host: "github.com", repo, op: "fetch" })).toEqual({ allowed: false, reason: "repo-not-on-list" });
    }
  });

  it("fails closed on a request or a list it does not understand", () => {
    const request = { host: "github.com", repo: "github.com/example-org/app" };
    const fetch: GitGatewayRequest = { ...request, op: "fetch" };
    expect(() => decideGitRequest(scope, { ...request, op: "clone" as GitGatewayOp })).toThrow(TypeError);
    expect(() => decideGitRequest(scope, request as GitGatewayRequest)).toThrow(TypeError);
    // An object that did not come from verifyGitScope is refused by the type; if forced through, an unknown access allows nothing.
    const unverified = { repos: [{ repo: "github.com/example-org/app", access: "admin" }] };
    // @ts-expect-error an unverified object is not a VerifiedGitScope
    expect(decideGitRequest(unverified, fetch)).toEqual({ allowed: false, reason: "fetch-only" });
    const built: GitScopePayload = { v: 1, claim: "c", ns: "n", tpl: "t", profile: "p", iat: 1, exp: 2, repos: [{ repo: "github.com/example-org/app", access: "rw" }] };
    // @ts-expect-error a payload that was only built, not verified, is not a VerifiedGitScope either
    const decision = decideGitRequest(built, fetch);
    expect(decision.allowed).toBe(true); // which is why the type, not this function, has to stop it
  });
});
