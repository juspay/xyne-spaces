import { describe, expect, it } from "vitest";
import { sameRepoConfig } from "./sandbox-repo-configs.js";

describe("sameRepoConfig", () => {
  it("ignores key order and undefined fields, catches real edits", () => {
    const code = { name: "x", steps: [{ type: "run", cmd: "a" }], ports: { web: 3000 } };
    expect(sameRepoConfig(code, { ports: { web: 3000 }, steps: [{ cmd: "a", type: "run" }], name: "x", cwd: undefined })).toBe(true);
    expect(sameRepoConfig(code, { ...code, name: "y" })).toBe(false);
  });
});
