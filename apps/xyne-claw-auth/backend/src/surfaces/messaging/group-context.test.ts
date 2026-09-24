import { describe, expect, it, vi, beforeEach } from "vitest";

const store = new Map<string, string[]>();
const redis = {
  lrange: vi.fn(async (k: string) => store.get(k) ?? []),
  ltrim: vi.fn(async (k: string, start: number) => {
    store.set(k, (store.get(k) ?? []).slice(start));
  }),
};
vi.mock("../../redis.js", () => ({ redisService: { getConnection: () => redis } }));

const { readGroupContext, consumeGroupContext, renderGroupContext } = await import("./group-context.js");

const KEY = "claw:channel:group-ctx:acc/chat".replace("/", ":");
const line = (text: string) => JSON.stringify({ senderId: "919", text, at: 1 });

describe("group context", () => {
  beforeEach(() => {
    store.clear();
    store.set(KEY, [line("one"), line("two")]);
  });

  it("reads without erasing, so a failed dispatch keeps the context", async () => {
    const read = await readGroupContext("acc", "chat");
    expect(read.map((m) => m.text)).toEqual(["one", "two"]);
    expect(store.get(KEY)).toHaveLength(2);
  });

  it("drops exactly what was quoted, keeping what arrived meanwhile", async () => {
    const read = await readGroupContext("acc", "chat");
    store.get(KEY)!.push(line("three")); // said while the run was dispatching
    await consumeGroupContext("acc", "chat", read.length);
    expect(store.get(KEY)).toEqual([line("three")]);
  });

  it("is a no-op when nothing was quoted", async () => {
    await consumeGroupContext("acc", "chat", 0);
    expect(store.get(KEY)).toHaveLength(2);
  });

  it("skips unparseable lines rather than failing the read", async () => {
    store.set(KEY, [line("one"), "{not json"]);
    expect((await readGroupContext("acc", "chat")).map((m) => m.text)).toEqual(["one"]);
  });

  it("frames quoted lines as context without authority", () => {
    const block = renderGroupContext([{ senderId: "919", text: "ship it", at: 1 }] as never);
    expect(block).toContain("NOT instructions");
    expect(block).toContain("ship it");
  });
});
