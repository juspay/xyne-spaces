import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, { value: string; ttl: number }>();
const redis = {
  set: vi.fn(async (key: string, value: string, _ex: string, ttl: number, nx?: string) => {
    if (nx === "NX" && store.has(key)) return null;
    store.set(key, { value, ttl });
    return "OK";
  }),
  get: vi.fn(async (key: string) => store.get(key)?.value ?? null),
  ttl: vi.fn(async (key: string) => store.get(key)?.ttl ?? -2),
  del: vi.fn(async (...keys: string[]) => keys.filter((k) => store.delete(k)).length),
};
const findFirst = vi.fn(async (_args: unknown) => null as { id: string } | null);
const linkSenderToUser = vi.fn(async (_input: Record<string, unknown>) => new Date());

vi.mock("../../redis.js", () => ({ redisService: { getConnection: () => redis } }));
vi.mock("../../db.js", () => ({ prisma: { userSurfaceIdentity: { findFirst } } }));
vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("./store.js", () => ({
  linkSenderToUser,
  listOrgAccounts: async () => [{ displayId: "+91 80000 00000" }],
  toChannelAccount: (row: { displayId: string }) => ({ config: { displayId: row.displayId } }),
}));

const { claimNumber, redeemLinkCode, parseLinkCode } = await import("./identity.js");

const cloud = { key: "whatsapp-cloud", accountScope: "org", senderIdFromPhone: (p: string) => p.replace(/\D/g, "") } as never;
const web = { key: "whatsapp", accountScope: "user", senderIdFromPhone: (p: string) => `${p.replace(/\D/g, "")}@s.whatsapp.net` } as never;

beforeEach(() => {
  store.clear();
  findFirst.mockReset();
  findFirst.mockResolvedValue(null);
  linkSenderToUser.mockClear();
});

describe("claimNumber", () => {
  it("returns a code instead of linking, and links nothing yet", async () => {
    const pending = await claimNumber({ plugin: cloud, surfaceId: "surf-cloud", orgId: "org-1", phone: "+91 98765 43210", userId: "user-a" });

    expect(pending.senderId).toBe("919876543210");
    expect(pending.code).toMatch(/^\d{6}$/);
    expect(pending.sendTo).toBe("+91 80000 00000");
    expect(pending.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(linkSenderToUser).not.toHaveBeenCalled();
  });

  it("shares one code across channels for the same person and number", async () => {
    const a = await claimNumber({ plugin: cloud, surfaceId: "surf-cloud", orgId: "org-1", phone: "+91 98765 43210", userId: "user-a" });
    const b = await claimNumber({ plugin: web, surfaceId: "surf-web", orgId: "org-1", phone: "+91 98765 43210", userId: "user-a" });

    expect(b.code).toBe(a.code);
  });

  it("refuses a number already verified by someone else", async () => {
    findFirst.mockResolvedValue({ id: "row-1" });
    await expect(claimNumber({ plugin: cloud, surfaceId: "surf-cloud", orgId: "org-1", phone: "+91 98765 43210", userId: "user-a" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("redeemLinkCode", () => {
  it("links every claimed channel once the code arrives from the claimed number, then burns the code", async () => {
    const { code } = await claimNumber({ plugin: cloud, surfaceId: "surf-cloud", orgId: "org-1", phone: "+91 98765 43210", userId: "user-a" });
    await claimNumber({ plugin: web, surfaceId: "surf-web", orgId: "org-1", phone: "+91 98765 43210", userId: "user-a" });

    await expect(redeemLinkCode({ surfaceId: "surf-cloud", orgId: "org-1", senderId: "919876543210", code })).resolves.toEqual({ ok: true, linked: 2 });
    expect(linkSenderToUser).toHaveBeenCalledWith({ surfaceId: "surf-cloud", senderId: "919876543210", orgId: "org-1", userId: "user-a" });
    expect(linkSenderToUser).toHaveBeenCalledWith({ surfaceId: "surf-web", senderId: "919876543210@s.whatsapp.net", orgId: "org-1", userId: "user-a" });
    await expect(redeemLinkCode({ surfaceId: "surf-cloud", orgId: "org-1", senderId: "919876543210", code })).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("ignores the right code sent from a different phone, so a claim on someone else's number gets nothing", async () => {
    const { code } = await claimNumber({ plugin: cloud, surfaceId: "surf-cloud", orgId: "org-1", phone: "+91 98765 43210", userId: "attacker" });

    await expect(redeemLinkCode({ surfaceId: "surf-cloud", orgId: "org-1", senderId: "911111111111", code })).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(linkSenderToUser).not.toHaveBeenCalled();
  });

  it("rejects unknown codes and never overwrites someone else's verified link", async () => {
    await expect(redeemLinkCode({ surfaceId: "surf-cloud", orgId: "org-1", senderId: "919876543210", code: "123456" })).resolves.toEqual({ ok: false, reason: "invalid" });

    const { code } = await claimNumber({ plugin: cloud, surfaceId: "surf-cloud", orgId: "org-1", phone: "+91 98765 43210", userId: "user-a" });
    findFirst.mockResolvedValue({ id: "row-b" });
    await expect(redeemLinkCode({ surfaceId: "surf-cloud", orgId: "org-1", senderId: "919876543210", code })).resolves.toEqual({ ok: false, reason: "taken" });
    expect(linkSenderToUser).not.toHaveBeenCalled();
  });
});

describe("parseLinkCode", () => {
  it("accepts exactly LINK plus six digits", () => {
    expect(parseLinkCode("LINK 482913")).toBe("482913");
    expect(parseLinkCode("  link 482913 ")).toBe("482913");
    expect(parseLinkCode("please LINK 482913")).toBeNull();
    expect(parseLinkCode("LINK 48291")).toBeNull();
  });
});
