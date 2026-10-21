import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string>());

vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      mget: vi.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return "OK";
      }),
    }),
  },
}));

import { loadKnownMcpTools, recordKnownMcpTools } from "./mcp-tool-name-index.js";

describe("mcp tool name index", () => {
  beforeEach(() => store.clear());

  it("round-trips tool names per user and server", async () => {
    await recordKnownMcpTools("u1", "port", [{ name: "list_entities" }, { name: "get", selectionKey: "port-get" }]);
    const known = await loadKnownMcpTools("u1", ["port", "jotform"]);
    expect(known.get("port")).toEqual([{ name: "list_entities" }, { name: "get", selectionKey: "port-get" }]);
    expect(known.has("jotform")).toBe(false);
    expect((await loadKnownMcpTools("u2", ["port"])).has("port")).toBe(false);
  });

  it("does not record an empty tool list", async () => {
    await recordKnownMcpTools("u1", "port", []);
    expect((await loadKnownMcpTools("u1", ["port"])).has("port")).toBe(false);
  });

  it("treats a corrupt entry as unknown", async () => {
    store.set("claw:mcp-tool-names:u1:port", "{not json");
    expect((await loadKnownMcpTools("u1", ["port"])).has("port")).toBe(false);
  });
});
