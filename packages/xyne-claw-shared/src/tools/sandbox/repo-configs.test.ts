import { describe, expect, it } from "vitest";
import * as repoConfigs from "./repo-configs.js";

/**
 * Open-source scrub guard: REPO_CONFIGS drives the sandbox-repo-setup tooling
 * and its seed data must not point at internal (non-public) git
 * infrastructure. Internal deployments restore the real host with
 * XYNE_INTERNAL_GIT_HOST (see internalGitBaseUrl).
 */
const INTERNAL_HOST = /juspay\.(net|in|com)|rbihub|svc\.k8s/i;

function allRepoUrls(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, cfg] of Object.entries(repoConfigs.REPO_CONFIGS)) {
    if (cfg.repoUrl) out.push([`REPO_CONFIGS["${key}"].repoUrl`, cfg.repoUrl]);
    for (const aux of cfg.auxRepos ?? []) {
      out.push([`REPO_CONFIGS["${key}"] auxRepo ${aux.name}`, aux.url]);
    }
  }
  return out;
}

describe("REPO_CONFIGS internal-host scrub", () => {
  it("seeds no repoUrl or auxRepo URL pointing at internal infrastructure", () => {
    const leaking = allRepoUrls().filter(([, url]) => INTERNAL_HOST.test(url));
    expect(
      leaking,
      `internal URLs seeded in REPO_CONFIGS: ${JSON.stringify(leaking)}`,
    ).toEqual([]);
  });

  it("resolves internal git URLs from XYNE_INTERNAL_GIT_HOST at call time", () => {
    process.env.XYNE_INTERNAL_GIT_HOST = "bitbucket.internal.example";
    try {
      expect(repoConfigs.internalGitUrl("lp/torana.git")).toBe(
        "ssh://git@bitbucket.internal.example/lp/torana.git",
      );
    } finally {
      delete process.env.XYNE_INTERNAL_GIT_HOST;
    }
  });

  it("defaults to a neutral placeholder host when the env var is unset", () => {
    delete process.env.XYNE_INTERNAL_GIT_HOST;
    expect(repoConfigs.internalGitUrl("ax/clms-corp.git")).toBe(
      "ssh://git@ssh.bitbucket.example.internal/ax/clms-corp.git",
    );
  });
});
