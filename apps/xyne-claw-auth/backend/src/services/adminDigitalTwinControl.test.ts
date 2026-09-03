import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userCount: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  cancelBackfill: vi.fn(),
  enqueueBackfill: vi.fn(),
  ensureTwinBank: vi.fn(),
  ensureDefaultFiles: vi.fn(),
}));

vi.mock("../db.js", () => ({
  prisma: {
    user: {
      count: mocks.userCount,
      findUnique: mocks.userFindUnique,
      update: mocks.userUpdate,
    },
  },
}));

vi.mock("./userMemoryCuratorClient.js", () => ({ ensureTwinBank: mocks.ensureTwinBank }));
vi.mock("./agentMemoryFiles.js", () => ({
  TWIN_AGENT_SLUG: "digital-twin",
  ensureDefaultFiles: mocks.ensureDefaultFiles,
}));
vi.mock("../queue/digital-twin-backfill-queue.js", () => ({
  cancelDigitalTwinBackfill: mocks.cancelBackfill,
  enqueueDigitalTwinBackfill: mocks.enqueueBackfill,
}));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  AdminDigitalTwinControlError,
  adminDisableDigitalTwin,
  adminEnableDigitalTwin,
  buildAdminBackfillState,
  parseAdminBackfillWindow,
  summarizeAdminBackfill,
} from "./adminDigitalTwinControl.js";

describe("admin Digital Twin lifecycle controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userCount.mockResolvedValue(1);
    mocks.userUpdate.mockResolvedValue({});
    mocks.cancelBackfill.mockResolvedValue(0);
    mocks.enqueueBackfill.mockImplementation(async ({ source }: { source: string }) => `job-${source}`);
    mocks.ensureTwinBank.mockResolvedValue(undefined);
    mocks.ensureDefaultFiles.mockResolvedValue(undefined);
  });

  it("builds the same three-source chronological backfill state used by the user pipeline", () => {
    const now = new Date("2026-08-15T10:00:00.000Z");
    const window = parseAdminBackfillWindow(
      { from: "2026-05-15T10:00:00.000Z", to: "2026-08-15T10:00:00.000Z" },
      now,
    );
    const state = buildAdminBackfillState(window, now);

    expect(Object.keys(state)).toEqual(["messages", "calls", "canvases"]);
    for (const source of Object.values(state)) {
      expect(source).toMatchObject({
        from: "2026-05-15T10:00:00.000Z",
        to: "2026-08-15T10:00:00.000Z",
        cursor: "2026-05-15T10:00:00.000Z",
        complete: false,
        progress: { windowsDone: 0, recordsSeen: 0, candidatesMade: 0 },
      });
    }
  });

  it("rejects invalid and over-24-month backfill windows", () => {
    expect(() => parseAdminBackfillWindow({ from: "not-a-date" })).toThrow(AdminDigitalTwinControlError);
    expect(() => parseAdminBackfillWindow({
      from: "2024-01-01T00:00:00.000Z",
      to: "2026-08-15T00:00:00.000Z",
    })).toThrow("24 months or fewer");
  });

  it("accepts an exact 24-calendar-month preset", () => {
    expect(parseAdminBackfillWindow({
      from: "2024-08-15T00:00:00.000Z",
      to: "2026-08-15T00:00:00.000Z",
    })).toMatchObject({
      from: new Date("2024-08-15T00:00:00.000Z"),
      to: new Date("2026-08-15T00:00:00.000Z"),
    });
  });

  it("disable mutates only Digital Twin enable/backfill columns and never deletes user data", async () => {
    mocks.cancelBackfill.mockResolvedValue(3);

    await expect(adminDisableDigitalTwin("user-1")).resolves.toEqual({ cancelledJobs: 3 });
    expect(mocks.userUpdate).toHaveBeenCalledOnce();
    const update = mocks.userUpdate.mock.calls[0]?.[0] as { where: unknown; data: Record<string, unknown> };
    expect(update.where).toEqual({ id: "user-1" });
    expect(Object.keys(update.data).sort()).toEqual(["digitalTwinBackfillState", "digitalTwinEnabled"]);
    expect(update.data.digitalTwinEnabled).toBe(false);
  });

  it("enable only writes Digital Twin lifecycle columns and queues all selected sources", async () => {
    await expect(adminEnableDigitalTwin({
      userId: "user-1",
      backfill: {
        from: "2026-05-15T00:00:00.000Z",
        to: "2026-08-15T00:00:00.000Z",
      },
    })).resolves.toMatchObject({
      backfillJobIds: ["job-messages", "job-calls", "job-canvases"],
    });

    const update = mocks.userUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(Object.keys(update.data).sort()).toEqual([
      "digitalTwinBackfillState",
      "digitalTwinEnabled",
      "digitalTwinEnabledAt",
    ]);
    expect(mocks.ensureDefaultFiles).toHaveBeenCalledWith("digital-twin", "user-1");
    expect(mocks.enqueueBackfill).toHaveBeenCalledTimes(3);
  });

  it("summarizes list-row progress without exposing the raw state", () => {
    const summary = summarizeAdminBackfill({
      messages: { complete: true, from: "2026-01-01", to: "2026-02-01", progress: { windowsDone: 1, windowsTotal: 1, recordsSeen: 10, candidatesMade: 2 } },
      calls: { complete: false, from: "2026-01-01", to: "2026-02-01", progress: { windowsDone: 0, windowsTotal: 1, recordsSeen: 3, candidatesMade: 1 } },
      canvases: { complete: false, pausedAt: "2026-02-01", from: "2026-01-01", to: "2026-02-01", progress: { windowsDone: 0, windowsTotal: 1 } },
    });
    expect(summary).toMatchObject({ status: "running", progressPct: 33, recordsSeen: 13, candidatesMade: 3 });
  });
});
