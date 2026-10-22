import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const rows = new Map<string, unknown>();
const key = (userId: string, orgId: string) => `${userId}|${orgId}`;
const prisma = {
  deliveryPreference: {
    findUnique: vi.fn(async ({ where }: { where: { userId_orgId: { userId: string; orgId: string } } }) => {
      const order = rows.get(key(where.userId_orgId.userId, where.userId_orgId.orgId));
      return order ? { order } : null;
    }),
    upsert: vi.fn(async ({ create }: { create: { userId: string; orgId: string; order: unknown } }) => {
      rows.set(key(create.userId, create.orgId), create.order);
      return create;
    }),
    deleteMany: vi.fn(async ({ where }: { where: { userId: string; orgId: string } }) => {
      rows.delete(key(where.userId, where.orgId));
      return { count: 1 };
    }),
  },
};
vi.mock("../db.js", () => ({ prisma }));

let whatsapp: { via: "identity" | "own-device" } | null = null;
vi.mock("../surfaces/messaging/agent-tools.js", () => ({ findNotifyTarget: vi.fn(async () => whatsapp) }));

describe("/settings/delivery-preference", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    const { deliveryPreferenceRouter } = await import("./delivery-preference.js");
    const { errorMiddleware } = await import("../lib/http.js");
    const app = express();
    app.use(express.json());
    app.use("/pref", deliveryPreferenceRouter);
    app.use(errorMiddleware);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pref`;
  });

  afterAll(() => {
    server?.close();
  });

  beforeEach(() => {
    rows.clear();
    whatsapp = null;
    prisma.deliveryPreference.upsert.mockClear();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = async (res: Response): Promise<{ data: any }> => (await res.json()) as { data: any };

  const call = (method: string, body?: unknown, headers: Record<string, string> = { "x-user-id": "user-1", "x-org-id": "org-1" }) =>
    fetch(base, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  it("reports the default for someone who never chose", async () => {
    const res = await call("GET");
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({
      order: ["spaces"],
      chosen: false,
      surfaces: [
        { surface: "spaces", available: true, approvals: true },
        { surface: "whatsapp", available: false, approvals: false, reason: "not_linked" },
        { surface: "teams", available: false, approvals: false, reason: "unavailable" },
      ],
    });
  });

  it("stores a de-duplicated order with Spaces appended, and returns it", async () => {
    whatsapp = { via: "identity" };
    const res = await call("PUT", { order: ["whatsapp", "teams", "whatsapp"] });
    expect(res.status).toBe(200);
    const data = (await json(res)).data;
    expect(data.order).toEqual(["whatsapp", "teams", "spaces"]);
    expect(data.chosen).toBe(true);
    expect(data.surfaces[1]).toEqual({ surface: "whatsapp", available: true, approvals: true });
    expect(prisma.deliveryPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { userId: "user-1", orgId: "org-1", order: ["whatsapp", "teams", "spaces"] } }),
    );
  });

  it("does not offer approvals on an own-device WhatsApp", async () => {
    whatsapp = { via: "own-device" };
    const data = (await json(await call("GET"))).data;
    expect(data.surfaces[1]).toEqual({ surface: "whatsapp", available: true, approvals: false });
  });

  it("rejects unknown surfaces and a missing order without writing", async () => {
    expect((await call("PUT", { order: ["whatsapp", "pager"] })).status).toBe(400);
    expect((await call("PUT", {})).status).toBe(400);
    expect(prisma.deliveryPreference.upsert).not.toHaveBeenCalled();
  });

  it("DELETE returns the person to the default", async () => {
    await call("PUT", { order: ["whatsapp"] });
    const data = (await json(await call("DELETE"))).data;
    expect(data).toMatchObject({ order: ["spaces"], chosen: false });
  });

  it("keeps each person's choice to themselves", async () => {
    await call("PUT", { order: ["whatsapp"] });
    const other = await call("GET", undefined, { "x-user-id": "user-2", "x-org-id": "org-1" });
    expect((await json(other)).data).toMatchObject({ chosen: false });
    const otherOrg = await call("GET", undefined, { "x-user-id": "user-1", "x-org-id": "org-2" });
    expect((await json(otherOrg)).data).toMatchObject({ chosen: false });
  });

  it("refuses a request with no signed-in org session", async () => {
    expect((await call("GET", undefined, {})).status).toBe(401);
  });
});
