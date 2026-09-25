import { describe, it, expect, vi } from "vitest";
import path from "node:path";

vi.mock("../src/config.js", () => ({ PATHS: { dataDir: "/data" } }));

describe("isAllowedCwd", () => {
  it("rejects the workspaces root and any path under it", async () => {
    const { isAllowedCwd } = await import("../src/workspace.js");
    expect(isAllowedCwd(path.join("/data", "workspaces"))).toBe(false);
    expect(isAllowedCwd(path.join("/data", "workspaces", "victim-key"))).toBe(false);
    expect(isAllowedCwd(path.join("/data", "workspaces", "mine", "..", "victim-key"))).toBe(false);
  });

  it("rejects relative paths and unrelated absolute paths", async () => {
    const { isAllowedCwd } = await import("../src/workspace.js");
    expect(isAllowedCwd("workspaces/mine")).toBe(false);
    expect(isAllowedCwd("/etc")).toBe(false);
  });
});
