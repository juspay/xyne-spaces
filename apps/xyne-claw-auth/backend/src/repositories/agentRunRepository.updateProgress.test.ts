import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * updateProgress must not resurrect a finished run.
 *
 * Progress ticks can land AFTER the result callback finalized the run: a
 * subagent's sticky-label timer outlives its parent by seconds, and the push
 * is an unawaited fetch that cannot be cancelled. Ungated, such a straggler
 * rewrote currentToolLabel on a completed run, so the Agent Control Center
 * showed a finished run still "using" a tool (prod 2026-09-28).
 */

const db = vi.hoisted(() => ({
  rows: new Map<string, { status: string; currentToolLabel: string | null }>(),
  lastWhere: null as Record<string, unknown> | null,
}));

vi.mock("../db.js", () => ({
  prisma: {
    agentRun: {
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        db.lastWhere = where;
        const row = db.rows.get(where["sessionId"]);
        const statusMatches = where["status"] === undefined || row?.status === where["status"];
        if (!row || !statusMatches) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  },
}));

vi.mock("@prisma/client", () => ({
  Prisma: { sql: () => ({}), empty: {}, PrismaClientKnownRequestError: class extends Error {} },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { agentRunRepository } = await import("./agentRunRepository.js");

describe("agentRunRepository.updateProgress", () => {
  beforeEach(() => {
    db.rows.clear();
    db.lastWhere = null;
  });

  it("scopes the write to running rows", async () => {
    db.rows.set("s1", { status: "running", currentToolLabel: null });
    await agentRunRepository.updateProgress("s1", "get_file_content");

    expect(db.lastWhere).toEqual({ sessionId: "s1", status: "running" });
  });

  it("updates the label while the run is running", async () => {
    db.rows.set("s1", { status: "running", currentToolLabel: null });
    await agentRunRepository.updateProgress("s1", "get_file_content");

    expect(db.rows.get("s1")!.currentToolLabel).toBe("get_file_content");
  });

  it.each(["completed", "failed", "cancelled"])(
    "ignores a straggler tick for a %s run",
    async (status) => {
      db.rows.set("s1", { status, currentToolLabel: null });
      await agentRunRepository.updateProgress("s1", "get_file_content");

      // The finalizer already nulled the label; a late tick must not undo that.
      expect(db.rows.get("s1")!.currentToolLabel).toBeNull();
    },
  );

  it("is a no-op for an unknown session", async () => {
    await expect(agentRunRepository.updateProgress("nope", "a-tool")).resolves.toMatchObject({ count: 0 });
  });
});
