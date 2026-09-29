import { describe, expect, it } from "vitest";
import { findSandboxKeys, normalizeRepoUrl } from "./repo-url.js";

describe("normalizeRepoUrl", () => {
  it("reduces every common form of the same GitHub repo to one value", () => {
    const forms = [
      "https://github.com/example-org/xyne-spaces",
      "https://github.com/example-org/xyne-spaces.git",
      "https://github.com/Example-Org/Xyne-Spaces/",
      "git@github.com:example-org/xyne-spaces.git",
      "ssh://git@github.com/example-org/xyne-spaces.git",
      "https://token@github.com/example-org/xyne-spaces.git",
      "https://github.com/example-org/xyne-spaces/tree/main/apps",
      "github.com/example-org/xyne-spaces",
    ];
    for (const form of forms) expect(normalizeRepoUrl(form)).toBe("github.com/example-org/xyne-spaces");
  });

  it("matches Bitbucket Server ssh, https clone and browse URLs", () => {
    const forms = [
      "ssh://git@ssh.bitbucket.example.net/lp/torana.git",
      "ssh://git@ssh.bitbucket.example.net:7999/lp/torana.git",
      "https://bitbucket.example.net/scm/lp/torana.git",
      "https://bitbucket.example.net/projects/LP/repos/torana/browse",
    ];
    for (const form of forms) expect(normalizeRepoUrl(form)).toBe("bitbucket.example.net/lp/torana");
  });

  it("rejects values that are not a repo URL", () => {
    expect(normalizeRepoUrl("")).toBeNull();
    expect(normalizeRepoUrl("torana")).toBeNull();
    expect(normalizeRepoUrl("https://github.com/example-org")).toBeNull();
  });
});

describe("findSandboxKeys", () => {
  const configs = {
    "xyne-spaces": { repoUrl: "ssh://git@github.com/example-org/xyne-spaces.git" },
    "xyne-spaces-light": { repoUrl: "https://github.com/example-org/xyne-spaces" },
    torana: { repoUrl: "ssh://git@ssh.bitbucket.example.net/lp/torana.git" },
    "no-url": {},
  };

  it("returns every config key for the repo, sorted", () => {
    expect(findSandboxKeys(configs, "https://github.com/example-org/xyne-spaces.git")).toEqual(["xyne-spaces", "xyne-spaces-light"]);
    expect(findSandboxKeys(configs, "https://bitbucket.example.net/scm/lp/torana.git")).toEqual(["torana"]);
  });

  it("returns nothing for an unknown or malformed URL", () => {
    expect(findSandboxKeys(configs, "https://github.com/example-org/other")).toEqual([]);
    expect(findSandboxKeys(configs, "not a url")).toEqual([]);
  });
});
