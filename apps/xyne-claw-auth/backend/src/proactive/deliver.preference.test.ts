import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../surfaces/messaging/agent-tools.js", () => ({ findNotifyTarget: vi.fn() }));

const dispatchOrQueueChannelRun = vi.fn(async (..._args: unknown[]) => ({ kind: "dispatched", sessionId: "sess-1", accepted: true }));
vi.mock("../surfaces/messaging/busy.js", () => ({ dispatchOrQueueChannelRun }));

let storedOrder: unknown = null;
const now = new Date("2026-10-22T10:00:00Z");
const prisma = {
  agent: {
    findUnique: vi.fn(async () => ({ id: "agent-1", slug: "assistant", name: "Assistant", orgId: "org-1", config: {}, enabled: true, delegationTier: null })),
  },
  surfaceAgent: { findMany: vi.fn(async () => [{ surfaceId: "surf-wa", surfaceTenantId: "acct-key" }]) },
  connectedSurface: {
    findMany: vi.fn(async () => [{ id: "cs-1", orgId: "org-1", surfaceId: "surf-wa", surfaceTenantId: "acct-key", surface: { key: "whatsapp-cloud" } }]),
  },
  userSurfaceIdentity: {
    findFirst: vi.fn(async () => ({ surfaceUserId: "910000000001", lastSeenAt: new Date(now.getTime() - 3_600_000) })),
  },
  deliveryPreference: { findUnique: vi.fn(async () => (storedOrder === null ? null : { order: storedOrder })) },
};
vi.mock("../db.js", () => ({ prisma }));

const { deliverNudge } = await import("./deliver.js");

const nudge = { userId: "user-1", agentId: "agent-1", task: "nudge", idempotencyKey: "k", now };

beforeEach(() => {
  storedOrder = null;
  dispatchOrQueueChannelRun.mockClear();
});

describe("deliverNudge and the delivery preference", () => {
  it("with no preference nudges on WhatsApp exactly as before", async () => {
    expect(await deliverNudge(nudge)).toEqual({ ok: true, channel: "whatsapp-cloud", sessionId: "sess-1" });
  });

  it("still nudges on WhatsApp when it is anywhere in the chosen order", async () => {
    storedOrder = ["spaces", "teams", "whatsapp"];
    expect(await deliverNudge(nudge)).toMatchObject({ ok: true, channel: "whatsapp-cloud" });
  });

  it("does not nudge on WhatsApp when the person left it out", async () => {
    storedOrder = ["teams", "spaces"];
    expect(await deliverNudge(nudge)).toEqual({ ok: false, reason: "preference_excludes_whatsapp" });
    expect(dispatchOrQueueChannelRun).not.toHaveBeenCalled();
  });
});
