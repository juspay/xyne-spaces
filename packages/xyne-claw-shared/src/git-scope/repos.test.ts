import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// The built-in Bitbucket profiles take their host from the environment when the module loads.
vi.hoisted(() => {
  process.env["BITBUCKET_SSH_HOST"] ??= "ssh.bitbucket.example.net";
});

import { normalizeRepoUrl } from "../tools/sandbox/repo-url.js";
import { REPO_CONFIGS } from "../tools/sandbox/repo-configs.js";
import type { RepoSetupConfig } from "../tools/sandbox/tools.js";
import { GitScopeError, gitScopeReposForProfile, isCanonicalGitScopeHost, isCanonicalGitScopeRepo, type GitScopeProfileRepos } from "./index.js";

interface VectorFile {
  addresses: { address: string; repo: string | null }[];
  profiles: { name: string; about: string; config: GitScopeProfileRepos; repos: string[] | null }[];
}
const vectors = JSON.parse(readFileSync(new URL("./__tests__/git-scope-vectors.json", import.meta.url), "utf8")) as VectorFile;

const aux = (name: string, url: string) => ({ name, url, defaultBranch: "main", workDir: `/workspace/${name}` });

describe("gitScopeReposForProfile", () => {
  it("lists repoUrl and every aux repo, canonical, without repeats, sorted", () => {
    const repos = gitScopeReposForProfile({
      slug: "example",
      repoUrl: "ssh://git@ssh.bitbucket.example.net/proj/service.git",
      auxRepos: [
        aux("tools", "https://bitbucket.example.net/scm/~JDOE/tools.git"),
        aux("app", "git@github.com:Example-Org/App.git"),
        aux("service-again", "https://bitbucket.example.net/projects/PROJ/repos/service/browse"),
        aux("app-again", "https://github.com/example-org/app"),
      ],
    });
    expect(repos).toEqual(["bitbucket.example.net/proj/service", "bitbucket.example.net/~jdoe/tools", "github.com/example-org/app"]);
  });

  it("gives the same list whatever order the profile names its repositories in", () => {
    const urls = ["https://github.com/example-org/b", "https://github.com/example-org/a", "https://gitlab.example.com/z/y", "https://bitbucket.example.net/scm/k/l.git"];
    const expected = ["bitbucket.example.net/k/l", "github.com/example-org/a", "github.com/example-org/b", "gitlab.example.com/z/y"];
    for (let rotation = 0; rotation < urls.length; rotation++) {
      const [repoUrl = "", ...rest] = [...urls.slice(rotation), ...urls.slice(0, rotation)];
      expect(gitScopeReposForProfile({ repoUrl, auxRepos: rest.map((url, i) => aux(`aux-${i}`, url)) })).toEqual(expected);
    }
  });

  it("returns an empty list for a profile without repositories", () => {
    expect(gitScopeReposForProfile({})).toEqual([]);
    expect(gitScopeReposForProfile({ repoUrl: undefined, auxRepos: undefined })).toEqual([]);
    expect(gitScopeReposForProfile({ repoUrl: "", auxRepos: [] })).toEqual([]);
    expect(gitScopeReposForProfile({ repoUrl: "   " })).toEqual([]);
    expect(gitScopeReposForProfile({ repoUrl: null, auxRepos: null } as unknown as GitScopeProfileRepos)).toEqual([]);
  });

  it("takes a RepoSetupConfig as it is", () => {
    const config: RepoSetupConfig = {
      slug: "example",
      name: "Example",
      description: "",
      repoUrl: "https://github.com/example-org/app.git",
      defaultBranch: "main",
      workDir: "/workspace/app",
      template: "agent-workspace-template",
      steps: [],
      auxRepos: [aux("tools", "git@github.com:example-org/tools.git")],
    };
    expect(gitScopeReposForProfile(config)).toEqual(["github.com/example-org/app", "github.com/example-org/tools"]);
  });

  it("can list every built-in profile", () => {
    expect(Object.keys(REPO_CONFIGS).length).toBeGreaterThan(0);
    for (const [key, config] of Object.entries(REPO_CONFIGS)) {
      const addresses = [config.repoUrl, ...(config.auxRepos ?? []).map((repo) => repo.url)].filter((url) => url !== undefined);
      const repos = gitScopeReposForProfile(config);
      expect(repos, key).toEqual([...new Set(addresses.map((url) => normalizeRepoUrl(url)))].sort());
      for (const repo of repos) expect(isCanonicalGitScopeRepo(repo), key).toBe(true);
    }
  });

  describe("fails for the whole profile when one address cannot be listed", () => {
    const good = "https://github.com/example-org/app";
    const unusable: [string, string][] = [
      ["a bare name", "app"],
      ["a host with one path segment", "https://github.com/example-org"],
      ["a local path", "file:///srv/git/app.git"],
      ["an address without a host (a built-in Bitbucket profile when BITBUCKET_SSH_HOST is not set)", "ssh://git@/proj/service.git"],
      ["free text", "not an address"],
      ["a space in the path", "https://github.com/example-org/app name"],
      ["a percent-encoded character", "https://github.com/example-org/app%20name"],
      ["a .. segment", "https://github.com/example-org/../other/app"],
      ["a . segment", "https://github.com/./example-org/app"],
      ["a password containing @", "https://user:p@ss@github.com/example-org/app.git"],
      ["an IPv6 host", "https://[2001:db8::1]/example-org/app.git"],
      ["a host ending in a dot", "https://github.com./example-org/app.git"],
      ["a host with an underscore", "https://git_hub.example.com/example-org/app.git"],
      ["a name ending in .git.git", "https://github.com/example-org/app.git.git"],
      ["a non-ASCII name", "https://github.com/example-org/appé"],
      ["a letter that only becomes ASCII when lower-cased (Kelvin sign for k)", "https://github.com/example-org/Kapp"],
      ["the same in the host", "https://github.Kom.example/example-org/app"],
      ["a control character", "https://github.com/example-org/app\u0000name"],
      ["a wildcard", "https://github.com/example-org/*"],
    ];

    it.each(unusable)("as repoUrl: %s", (_name, address) => {
      expect(normalizeRepoUrl(good)).not.toBeNull();
      expect(() => gitScopeReposForProfile({ slug: "example", repoUrl: address, auxRepos: [aux("app", good)] })).toThrow(GitScopeError);
    });

    it.each(unusable)("as an aux repo: %s", (_name, address) => {
      expect(() => gitScopeReposForProfile({ slug: "example", repoUrl: good, auxRepos: [aux("app", good), aux("broken", address)] })).toThrow(GitScopeError);
    });

    it("an aux entry without an address", () => {
      expect(() => gitScopeReposForProfile({ repoUrl: good, auxRepos: [aux("blank", "")] })).toThrow(GitScopeError);
      expect(() => gitScopeReposForProfile({ repoUrl: good, auxRepos: [{ name: "none" }] } as unknown as GitScopeProfileRepos)).toThrow(GitScopeError);
      expect(() => gitScopeReposForProfile({ repoUrl: good, auxRepos: [null] } as unknown as GitScopeProfileRepos)).toThrow(GitScopeError);
      expect(() => gitScopeReposForProfile({ repoUrl: good, auxRepos: "https://github.com/example-org/tools" } as unknown as GitScopeProfileRepos)).toThrow(GitScopeError);
      expect(() => gitScopeReposForProfile({ repoUrl: 7 } as unknown as GitScopeProfileRepos)).toThrow(GitScopeError);
    });

    it("names the profile and the field, and never repeats the address (it can carry a credential)", () => {
      const secret = "https://deploy:s3cr3t-t0ken@github.com/example-org";
      let message = "";
      try {
        gitScopeReposForProfile({ slug: "example", repoUrl: good, auxRepos: [aux("tools", good), aux("broken", secret)] });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain('profile "example"');
      expect(message).toContain('auxRepos[1] ("broken").url');
      expect(message).not.toContain("s3cr3t");
      expect(message).not.toContain("deploy");
      expect(() => gitScopeReposForProfile({ slug: "example", repoUrl: "https://user:p@ss@github.com/example-org/app.git" })).toThrow(/profile "example": repoUrl /);
    });
  });
});

describe("canonical form of a list entry", () => {
  it("is what the address normaliser returns and would return again", () => {
    for (const repo of ["github.com/example-org/app", "bitbucket.example.net/~jdoe/tools", "gitlab.example.com/group/subgroup/project", "git.internal/a/b", "10.0.0.5/a/b", "github.com/example-org/.github", "github.com/a_b/c-d.e"]) {
      expect(isCanonicalGitScopeRepo(repo), repo).toBe(true);
      expect(normalizeRepoUrl(repo), repo).toBe(repo);
    }
  });

  it("excludes every other spelling", () => {
    const others: unknown[] = [
      "",
      "github.com",
      "github.com/example-org",
      "github.com/example-org/",
      "github.com/example-org/app/",
      "/github.com/example-org/app",
      "github.com//example-org/app",
      "GitHub.com/example-org/app",
      "github.com/Example-Org/app",
      "github.com/example-org/app.git",
      "https://github.com/example-org/app",
      "git@github.com:example-org/app",
      "www.github.com/example-org/app",
      "ssh.bitbucket.example.net/proj/service",
      "bitbucket.example.net:7999/proj/service",
      "bitbucket.example.net/scm/proj/service",
      "bitbucket.example.net/projects/proj/repos/service",
      "github.com/example-org/app/tree/main",
      "github.com/example-org/app/-/tree",
      "github.com/example-org/../app",
      "github.com/example-org/./app",
      "github.com/example-org/app name",
      "github.com/example-org/app%2fname",
      "github.com/example-org/app?x",
      "github.com/example-org/app#x",
      "github.com/example-org/*",
      "github.com/example-org/app\n",
      "github.com./example-org/app",
      "git_hub.com/example-org/app",
      "-github.com/example-org/app",
      "user@github.com/example-org/app",
      `github.com/example-org/${"a".repeat(512)}`,
      null,
      undefined,
      7,
      ["github.com/example-org/app"],
    ];
    for (const other of others) expect(isCanonicalGitScopeRepo(other), String(other)).toBe(false);
  });

  it("applies the same rule to a host alone", () => {
    for (const host of ["github.com", "bitbucket.example.net", "localhost", "10.0.0.5", "a-b.example"]) expect(isCanonicalGitScopeHost(host), host).toBe(true);
    for (const host of ["", "GitHub.com", "ssh.example.com", "www.example.com", "example.com:22", "example.com.", ".example.com", "a..b", "-a.example", "a-.example", "a_b.example", "[::1]", `${"a".repeat(64)}.example`, 7, null]) {
      expect(isCanonicalGitScopeHost(host), String(host)).toBe(false);
    }
  });
});

describe("test vectors (./__tests__/git-scope-vectors.json)", () => {
  it.each(vectors.addresses.map((vector) => [JSON.stringify(vector.address), vector] as const))("address %s", (_name, { address, repo }) => {
    if (repo === null) expect(() => gitScopeReposForProfile({ repoUrl: address })).toThrow(GitScopeError);
    else expect(gitScopeReposForProfile({ repoUrl: address })).toEqual([repo]);
  });

  it.each(vectors.profiles.map((vector) => [vector.name, vector] as const))("profile %s", (_name, { config, repos }) => {
    if (repos === null) expect(() => gitScopeReposForProfile(config)).toThrow(GitScopeError);
    else expect(gitScopeReposForProfile(config)).toEqual(repos);
  });
});

/**
 * normalizeRepoUrl is now part of a signed format: a change to what it returns
 * changes which repository a list entry names. These pin the places where it
 * gives ONE name to addresses that can be different repositories. A list
 * cannot tell them apart; see the note on each.
 */
describe("limits inherited from normalizeRepoUrl: different addresses, one entry", () => {
  const entry = (address: string): string[] => gitScopeReposForProfile({ repoUrl: address });

  it("letter case (matters only on a case-sensitive server)", () => {
    expect(entry("https://git.example.com/Team/App")).toEqual(entry("https://git.example.com/team/app"));
  });
  it("a first path segment 'scm' (Bitbucket's clone prefix; elsewhere it can be a real group)", () => {
    expect(entry("https://gitlab.example.com/scm/a/b.git")).toEqual(entry("https://gitlab.example.com/a/b.git"));
  });
  it("'projects/P/repos/R' (Bitbucket's web address; elsewhere it can be a real path)", () => {
    expect(entry("https://gitlab.example.com/projects/a/repos/b")).toEqual(entry("https://gitlab.example.com/a/b"));
  });
  it("anything after a third segment named tree, blob, src, browse, pull, pulls or -", () => {
    expect(entry("https://gitlab.example.com/a/b/src/c.git")).toEqual(entry("https://gitlab.example.com/a/b.git"));
    expect(entry("https://gitlab.example.com/a/b/src/c.git")).toEqual(entry("https://gitlab.example.com/a/b/src/d.git"));
  });
  it("the port, and a leading ssh. or www. on the host", () => {
    expect(entry("https://git.example.com:8443/a/b")).toEqual(entry("ssh://git@git.example.com:7999/a/b"));
    expect(entry("https://ssh.example.com/a/b")).toEqual(entry("https://example.com/a/b"));
    expect(entry("https://www.example.com/a/b")).toEqual(entry("https://example.com/a/b"));
  });
});

describe("limits inherited from normalizeRepoUrl: one repository, two entries", () => {
  it("Bitbucket's web address of a personal repository is not reduced to its clone address", () => {
    const clone = gitScopeReposForProfile({ repoUrl: "https://bitbucket.example.net/scm/~jdoe/tools.git" });
    const web = gitScopeReposForProfile({ repoUrl: "https://bitbucket.example.net/users/jdoe/repos/tools/browse" });
    expect(clone).toEqual(["bitbucket.example.net/~jdoe/tools"]);
    expect(web).toEqual(["bitbucket.example.net/users/jdoe/repos/tools/browse"]);
  });
  it("Azure DevOps ssh and https addresses of one repository differ", () => {
    const ssh = gitScopeReposForProfile({ repoUrl: "git@ssh.dev.azure.com:v3/org/project/repo" });
    const https = gitScopeReposForProfile({ repoUrl: "https://dev.azure.com/org/project/_git/repo" });
    expect(ssh).toEqual(["dev.azure.com/v3/org/project/repo"]);
    expect(https).toEqual(["dev.azure.com/org/project/_git/repo"]);
  });
});
