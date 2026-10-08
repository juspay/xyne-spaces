import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  pmessage: null as null | ((pattern: string, channel: string, raw: string) => void),
}));

vi.mock("../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      get: vi.fn(async (k: string) => redis.kv.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        redis.kv.set(k, v);
        return "OK";
      }),
      del: vi.fn(async () => 1),
      publish: vi.fn(async (channel: string, raw: string) => {
        redis.pmessage?.("claw:device-push:*", channel, raw);
        return 1;
      }),
      duplicate: () => ({
        psubscribe: vi.fn(async () => 1),
        on: vi.fn((event: string, fn: (pattern: string, channel: string, raw: string) => void) => {
          if (event === "pmessage") redis.pmessage = fn;
        }),
      }),
    }),
  },
}));

import { deviceCapabilities, parseDeviceCapabilities, serveDeviceStream, wakeDevice } from "./device-push.js";

describe("device push stream", () => {
  beforeEach(() => {
    redis.kv.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps only known capabilities", () => {
    expect(parseDeviceCapabilities("page-tools,shell,open-url,page-tools")).toEqual(["page-tools", "open-url"]);
    expect(parseDeviceCapabilities(undefined)).toEqual([]);
  });

  it("announces capabilities, drains queued calls on connect and on wake, then stops", async () => {
    const written: string[] = [];
    const queue = [{ id: "c1", toolName: "page-read", args: {} }];
    const stop = await serveDeviceStream({
      deviceId: "dev-1",
      capabilities: ["page-tools", "open-url"],
      write: (chunk) => written.push(chunk),
      nextCall: async () => queue.shift() ?? null,
      touch: () => undefined,
      heartbeatMs: 15_000,
    });

    expect(written[0]).toContain("event: ready");
    expect(written[1]).toContain('"id":"c1"');
    expect([...(await deviceCapabilities("dev-1"))]).toEqual(["page-tools", "open-url"]);

    queue.push({ id: "c2", toolName: "page-click", args: { ref: "e1" } });
    await wakeDevice("dev-1");
    await vi.waitFor(() => expect(written.some((w) => w.includes('"id":"c2"'))).toBe(true));

    await vi.advanceTimersByTimeAsync(15_000);
    expect(written).toContain(":ka\n\n");

    stop();
    queue.push({ id: "c3", toolName: "page-read", args: {} });
    await wakeDevice("dev-1");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(written.some((w) => w.includes('"id":"c3"'))).toBe(false);
  });
});
