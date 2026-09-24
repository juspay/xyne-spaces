import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      set: async (key: string, value: string) => void store.set(key, value),
      exists: async (key: string) => (store.has(key) ? 1 : 0),
    }),
  },
}));

const { markSdlcRun, withSdlcRunTools } = await import("./sdlc-run-tools.js");

describe("withSdlcRunTools", () => {
  beforeEach(() => store.clear());

  it("admits the SDLC tools only for a run start-run marked as in a hub", async () => {
    const stored = { subagents: ["jira"] };
    expect(await withSdlcRunTools(stored, "run-1")).toBe(stored);
    await markSdlcRun("run-1", "hub-1");
    const gated = await withSdlcRunTools(stored, "run-1");
    expect(gated?.subagents).toEqual(expect.arrayContaining(["jira", "github"]));
    expect(gated?.direct).toEqual(expect.arrayContaining(["spaces-sdlc-write-artifact"]));
  });

  it("leaves an unrestricted agent unrestricted", async () => {
    await markSdlcRun("run-2", "hub-1");
    expect(await withSdlcRunTools(undefined, "run-2")).toBeUndefined();
  });
});
