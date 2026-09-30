import { describe, expect, it } from "vitest";
import { buildEffectiveRepoConfigs, repoConfigsForWorkspace, type RepoConfigMap } from "./repo-config-source.js";
import type { RepoSetupConfig } from "./tools.js";

const config = (name: string): RepoSetupConfig => ({
  slug: name,
  name,
  description: "",
  defaultBranch: "main",
  workDir: "/w",
  template: `${name}-template`,
  steps: [],
});

const base: RepoConfigMap = { builtin: config("builtin") };
const overrides = [
  { key: "builtin", config: config("builtin-override"), enabled: true, workspaceId: null },
  { key: "ws1-profile", config: config("ws1"), enabled: true, workspaceId: "ws1" },
  { key: "ws2-profile", config: config("ws2"), enabled: true, workspaceId: "ws2" },
  { key: "unowned", config: config("unowned"), enabled: true, workspaceId: null },
  { key: "ws1-off", config: config("off"), enabled: false, workspaceId: "ws1" },
];

describe("buildEffectiveRepoConfigs", () => {
  it("keeps every owned row, stamped, and hides unowned ones", () => {
    const all = buildEffectiveRepoConfigs(overrides, base);
    expect(Object.keys(all).sort()).toEqual(["builtin", "ws1-profile", "ws2-profile"]);
    expect(all["builtin"]?.name).toBe("builtin-override");
    expect(all["builtin"]?.workspaceId).toBeUndefined();
    expect(all["ws1-profile"]?.workspaceId).toBe("ws1");
  });

  it("with a workspace keeps built-ins and that workspace's rows only", () => {
    expect(Object.keys(buildEffectiveRepoConfigs(overrides, base, "ws1")).sort()).toEqual(["builtin", "ws1-profile"]);
    expect(Object.keys(buildEffectiveRepoConfigs(overrides, base, null))).toEqual(["builtin"]);
  });

  it("repoConfigsForWorkspace filters the runtime cache per run", () => {
    const all = buildEffectiveRepoConfigs(overrides, base);
    expect(Object.keys(repoConfigsForWorkspace(all, "ws2")).sort()).toEqual(["builtin", "ws2-profile"]);
    expect(Object.keys(repoConfigsForWorkspace(all, undefined))).toEqual(["builtin"]);
  });
});
