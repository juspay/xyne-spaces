import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const queryRaw = vi.fn((q: Prisma.Sql) => q);
vi.mock("../db.js", () => ({ prisma: { $queryRaw: queryRaw, $transaction: vi.fn(async (ops: unknown[]) => ops) } }));

const { MAX_ANALYTICS_WORK_MEM_MB, runAnalytics } = await import("./metrics-sql.js");

describe("runAnalytics", () => {
  it("sets a local timeout and JIT off before the query in one transaction, with options only when asked", async () => {
    const settings = async (opts?: Parameters<typeof runAnalytics>[1]) => {
      queryRaw.mockClear();
      expect(await runAnalytics(Prisma.sql`SELECT 1`, opts)).toMatchObject({ sql: "SELECT 1" });
      const set = queryRaw.mock.calls[0]![0];
      return { sql: set.text, values: set.values };
    };
    expect(await settings()).toEqual({ sql: "SELECT set_config('statement_timeout', $1, true),set_config('jit', 'off', true)", values: ["8000"] });
    expect((await settings({ customPlan: true, timeoutMs: 3000 })).sql).toContain("set_config('plan_cache_mode', 'force_custom_plan', true)");
    expect((await settings({ workMemMb: 4096 })).values).toEqual(["8000", `${MAX_ANALYTICS_WORK_MEM_MB}MB`]);
  });
});
