import { describe, expect, it, vi } from "vitest";

const { extend } = vi.hoisted(() => ({ extend: vi.fn((_extension: unknown) => ({})) }));
vi.mock("@prisma/client", () => ({ PrismaClient: class { $extends = extend; } }));
vi.mock("../../retry.js", () => ({ withRetry: (fn: () => unknown) => fn(), retryForever: vi.fn() }));
vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn() }) }));
import "../../db.js";

describe("Agent persistence guard registration", () => {
  it("passes sanitized args to the registered Prisma query callback", async () => {
    // Exercise the registered callback, not just the sanitizer in isolation.
    // Live transaction behavior requires the integration check in the rollout.
    const extension = extend.mock.calls[0]![0] as unknown as {
      query: { $allOperations: (input: unknown) => unknown };
    };
    const query = vi.fn().mockResolvedValue({ id: "agent" });
    await extension.query.$allOperations({
      model: "Agent", operation: "create", query,
      args: { data: { config: { promptInjections: [{ content: "stale clone" }], tools: { custom: [] } } } },
    });
    expect(query).toHaveBeenCalledWith({ data: { config: { tools: { custom: [] } } } });
  });
});
