import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  userCount: vi.fn(),
  organizationFindMany: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  backfill: vi.fn(),
}));

vi.mock("../db.js", () => ({
  prisma: {
    user: { findMany: mocks.userFindMany, count: mocks.userCount },
    organization: { findMany: mocks.organizationFindMany },
  },
}));

vi.mock("../middleware/agent-acl.js", () => ({
  requireClawAdmin: (req: Request, res: Response, next: NextFunction) => {
    if (req.headers["x-test-role"] !== "claw-admin") {
      res.status(403).json({ success: false, error: "CLAW_ADMIN required" });
      return;
    }
    next();
  },
  getRequesterId: (req: Request) => req.headers["x-user-id"] as string | undefined,
}));

vi.mock("../services/adminDigitalTwinControl.js", () => ({
  AdminDigitalTwinControlError: class AdminDigitalTwinControlError extends Error {},
  adminEnableDigitalTwin: mocks.enable,
  adminDisableDigitalTwin: mocks.disable,
  adminStartDigitalTwinBackfill: mocks.backfill,
  summarizeAdminBackfill: () => ({ status: "not_started" }),
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { adminDigitalTwinRouter } from "./admin-digital-twin.js";

describe("admin Digital Twin router security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindMany.mockResolvedValue([]);
    mocks.userCount.mockResolvedValue(0);
    mocks.organizationFindMany.mockResolvedValue([]);
    mocks.enable.mockResolvedValue({ enabledAt: new Date("2026-08-15T00:00:00.000Z"), backfillJobIds: [] });
    mocks.disable.mockResolvedValue({ cancelledJobs: 0 });
  });

  type RouterLayer = {
    route?: { path: string; stack: Array<{ handle: (req: Request, res: Response, next: NextFunction) => unknown }> };
    handle: (req: Request, res: Response, next: NextFunction) => unknown;
  };

  const layers = (adminDigitalTwinRouter as unknown as { stack: RouterLayer[] }).stack;

  function responseProbe(): { response: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
    const status = vi.fn();
    const json = vi.fn();
    const response = { status, json } as unknown as Response;
    status.mockReturnValue(response);
    json.mockReturnValue(response);
    return { response, status, json };
  }

  it("places the CLAW_ADMIN guard before every list and mutation route", () => {
    expect(layers[0]?.route).toBeUndefined();
    expect(layers.slice(1).every((layer) => Boolean(layer.route))).toBe(true);

    const { response, status } = responseProbe();
    const next = vi.fn();
    layers[0]!.handle(
      { headers: {} } as Request,
      response,
      next,
    );

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.userFindMany).not.toHaveBeenCalled();
    expect(mocks.disable).not.toHaveBeenCalled();
  });

  it("the disable endpoint ignores unrelated user fields and passes only the path user id", async () => {
    const layer = layers.find((candidate) => candidate.route?.path === "/users/:userId/disable");
    const handler = layer?.route?.stack.at(-1)?.handle;
    expect(handler).toBeTypeOf("function");
    const { response, status, json } = responseProbe();
    await handler!(
      {
        params: { userId: "user-1" },
        headers: { "x-test-role": "claw-admin", "x-user-id": "admin-1" },
        body: { name: "Changed name", email: "changed@example.com", role: "CLAW_ADMIN" },
      } as unknown as Request,
      response,
      vi.fn(),
    );

    expect(status).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ success: true, data: { disabled: true, cancelledJobs: 0 } });
    expect(mocks.disable).toHaveBeenCalledOnce();
    expect(mocks.disable).toHaveBeenCalledWith("user-1");
    expect(mocks.enable).not.toHaveBeenCalled();
    expect(mocks.backfill).not.toHaveBeenCalled();
  });

  it("the enable endpoint accepts only the backfill window from its request body", async () => {
    const layer = layers.find((candidate) => candidate.route?.path === "/users/:userId/enable");
    const handler = layer?.route?.stack.at(-1)?.handle;
    const { response, status } = responseProbe();
    await handler!(
      {
        params: { userId: "user-2" },
        headers: { "x-test-role": "claw-admin", "x-user-id": "admin-1" },
        body: {
          backfill: null,
          name: "Changed name",
          email: "changed@example.com",
          digitalTwinMemoryApprovalMode: "auto",
        },
      } as unknown as Request,
      response,
      vi.fn(),
    );

    expect(status).not.toHaveBeenCalled();
    expect(mocks.enable).toHaveBeenCalledOnce();
    expect(mocks.enable).toHaveBeenCalledWith({ userId: "user-2", backfill: null });
  });

  it("returns a paginated, read-only projection instead of full user records", async () => {
    mocks.userFindMany.mockResolvedValue([{
      id: "user-1",
      name: "Ada",
      email: "ada@example.com",
      orgId: "org-1",
      digitalTwinEnabled: true,
      digitalTwinEnabledAt: new Date("2026-08-15T00:00:00.000Z"),
      digitalTwinBackfillState: { secretRawState: "must not leak" },
      org: { name: "Engineering" },
    }]);
    mocks.userCount
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    mocks.organizationFindMany.mockResolvedValue([{ id: "org-1", name: "Engineering" }]);

    const layer = layers.find((candidate) => candidate.route?.path === "/users");
    const handler = layer?.route?.stack.at(-1)?.handle;
    const { response, json } = responseProbe();
    await handler!(
      {
        query: { limit: "25", offset: "25", status: "enabled", search: "Ada", sort: "name_asc" },
        headers: { "x-test-role": "claw-admin" },
      } as unknown as Request,
      response,
      vi.fn(),
    );

    expect(mocks.userFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 25, take: 25 }));
    const payload = json.mock.calls[0]?.[0] as { data: { rows: Array<Record<string, unknown>>; total: number } };
    expect(payload.data.total).toBe(1);
    expect(payload.data.rows[0]).toEqual({
      id: "user-1",
      name: "Ada",
      email: "ada@example.com",
      orgId: "org-1",
      orgName: "Engineering",
      enabled: true,
      enabledAt: new Date("2026-08-15T00:00:00.000Z"),
      backfill: { status: "not_started" },
    });
    expect(payload.data.rows[0]).not.toHaveProperty("digitalTwinBackfillState");
  });
});
