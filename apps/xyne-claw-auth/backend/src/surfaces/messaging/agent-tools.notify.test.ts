import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../../redis.js", () => ({ redisService: { getConnection: () => ({}) } }));
vi.mock("./group-context.js", () => ({ readGroupContext: vi.fn() }));

const enqueueAndWait = vi.fn();
const enqueueOutbound = vi.fn(async (..._args: unknown[]) => undefined);
const document = { fileName: "update.pdf", mimeType: "application/pdf", data: "UERG" };
const asLeadAndDocument = vi.fn(async (text: string) => (text.length > 3000 ? { text: "lead", document } : null));
vi.mock("./delivery.js", () => ({ enqueueAndWait, enqueueOutbound, asLeadAndDocument }));

let identities: Array<{ orgId: string; surfaceUserId: string }> = [];
const findMany = vi.fn(async () => identities);
vi.mock("../../db.js", () => ({ prisma: { userSurfaceIdentity: { findMany } } }));

const account = (over: Record<string, unknown> = {}) => ({
  id: "acc-cloud",
  orgId: "org1",
  channel: "whatsapp-cloud",
  config: { desiredState: "running", connState: "connected" },
  channelConfig: { notificationTemplate: { name: "xyne_update", language: "en" } },
  ...over,
});
let orgAccounts: Array<ReturnType<typeof account>> = [];
let ownedAccounts: Array<ReturnType<typeof account>> = [];
vi.mock("./store.js", () => ({
  getAccount: vi.fn(),
  toChannelAccount: (row: unknown) => row,
  listOrgAccounts: async () => orgAccounts,
  listOwnedAccounts: async () => ownedAccounts,
}));

const { findNotifyTarget, notifyUser } = await import("./agent-tools.js");

beforeEach(() => {
  identities = [];
  orgAccounts = [];
  ownedAccounts = [];
  findMany.mockClear();
  enqueueAndWait.mockReset();
  enqueueOutbound.mockClear();
});

describe("findNotifyTarget", () => {
  it("reaches the user on their linked number via the org's running business number", async () => {
    identities = [{ orgId: "org1", surfaceUserId: "919876543210" }];
    orgAccounts = [account({ id: "stopped", config: { desiredState: "stopped", connState: "disconnected" } }), account()];
    const found = await findNotifyTarget("u1", "org1");
    expect(found).toMatchObject({ chatId: "919876543210", account: { id: "acc-cloud" }, template: { name: "xyne_update" } });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "u1", orgId: "org1" }) }));
  });

  it("falls back to the user's own linked device, landing in their own chat", async () => {
    ownedAccounts = [account({ id: "acc-own", channel: "whatsapp", channelConfig: {}, config: { desiredState: "running", connState: "connected", selfId: "919@s.whatsapp.net" } })];
    expect(await findNotifyTarget("u1", "org1")).toMatchObject({ account: { id: "acc-own" }, chatId: "919@s.whatsapp.net" });
  });

  it("is null when there is nowhere to reach them", async () => {
    expect(await findNotifyTarget("u1", "org1")).toBeNull();
    expect(await findNotifyTarget("", "org1")).toBeNull();
  });
});

describe("notifyUser", () => {
  it("sends with the template as the fallback, then any files", async () => {
    identities = [{ orgId: "org1", surfaceUserId: "919" }];
    orgAccounts = [account()];
    enqueueAndWait.mockResolvedValue({ ok: true });
    const file = { fileName: "r.pdf", mimeType: "application/pdf", data: "AA==" };
    expect(await notifyUser({ userId: "u1", orgId: "org1", text: "Your report is ready", attachments: [file] })).toEqual({ ok: true, viaTemplate: false });
    expect(enqueueAndWait).toHaveBeenCalledWith("acc-cloud", {
      kind: "text",
      chatId: "919",
      text: "Your report is ready",
      template: { name: "xyne_update", language: "en" },
    });
    expect(enqueueOutbound).toHaveBeenCalledWith("acc-cloud", { kind: "file", chatId: "919", attachment: file });
  });

  it("skips files when it had to fall back to the template", async () => {
    identities = [{ orgId: "org1", surfaceUserId: "919" }];
    orgAccounts = [account()];
    enqueueAndWait.mockResolvedValue({ ok: true, viaTemplate: true });
    await notifyUser({ userId: "u1", orgId: "org1", text: "x", attachments: [{ fileName: "a", mimeType: "text/plain", data: "" }] });
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("explains a closed window in words the agent can pass on", async () => {
    identities = [{ orgId: "org1", surfaceUserId: "919" }];
    orgAccounts = [account({ channelConfig: {} })];
    enqueueAndWait.mockResolvedValue({ ok: false, error: "WhatsApp Cloud API: More than 24 hours have passed since the recipient last replied" });
    const out = await notifyUser({ userId: "u1", orgId: "org1", text: "x" });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error).toContain("no notification template");
  });

  it("sends a long report as its lead plus a PDF, with the full text kept for a template", async () => {
    identities = [{ orgId: "org1", surfaceUserId: "919" }];
    orgAccounts = [account()];
    enqueueAndWait.mockResolvedValue({ ok: true });
    const long = "x".repeat(3500);
    await notifyUser({ userId: "u1", orgId: "org1", text: long });
    expect(enqueueAndWait.mock.calls[0]?.[1]).toMatchObject({ text: "lead", templateText: long });
    expect(enqueueOutbound).toHaveBeenCalledWith("acc-cloud", { kind: "file", chatId: "919", attachment: document });
  });

  it("refuses when the user has no WhatsApp", async () => {
    const out = await notifyUser({ userId: "u1", orgId: "org1", text: "x" });
    expect(out).toEqual({
      ok: false,
      reason: "no_target",
      error: "This person has no WhatsApp linked to Claw, so they can't be messaged there.",
    });
  });

  it("tags a closed window so callers can count it", async () => {
    identities = [{ orgId: "org1", surfaceUserId: "919" }];
    orgAccounts = [account({ channelConfig: {} })];
    enqueueAndWait.mockResolvedValue({ ok: false, error: "More than 24 hours have passed" });
    expect(await notifyUser({ userId: "u1", orgId: "org1", text: "x" })).toMatchObject({ ok: false, reason: "window_closed" });
  });

  it("prefers the daily brief template for a brief, with its own template text", async () => {
    identities = [{ orgId: "org1", surfaceUserId: "919" }];
    orgAccounts = [
      account({
        channelConfig: {
          notificationTemplate: { name: "xyne_update", language: "en" },
          dailyBriefTemplate: { name: "xyne_daily_brief", language: "en" },
        },
      }),
    ];
    enqueueAndWait.mockResolvedValue({ ok: true });
    await notifyUser({ userId: "u1", orgId: "org1", text: "full brief", templateKind: "dailyBrief", templateText: "3 things need you" });
    expect(enqueueAndWait.mock.calls[0]?.[1]).toMatchObject({
      text: "full brief",
      template: { name: "xyne_daily_brief" },
      templateText: "3 things need you",
    });
  });

  it("falls back to the notification template when no brief template is set", async () => {
    identities = [{ orgId: "org1", surfaceUserId: "919" }];
    orgAccounts = [account()];
    enqueueAndWait.mockResolvedValue({ ok: true });
    await notifyUser({ userId: "u1", orgId: "org1", text: "full brief", templateKind: "dailyBrief" });
    expect(enqueueAndWait.mock.calls[0]?.[1]).toMatchObject({ template: { name: "xyne_update" } });
  });
});
