import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/surface-resolver.js", () => ({ decryptSurfaceSecret: vi.fn(), encryptSurfaceSecret: vi.fn() }));

const tx = vi.hoisted(() => ({
  userSurfaceIdentity: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
}));
vi.mock("../../db.js", () => ({
  prisma: { $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) },
}));

const { linkVerifiedSender } = await import("./store.js");

const input = { surfaceId: "surface-wa", senderId: "15555550123", orgId: "org-test", userId: "user-owner" };

beforeEach(() => {
  vi.clearAllMocks();
  tx.userSurfaceIdentity.findMany.mockResolvedValue([]);
  tx.userSurfaceIdentity.upsert.mockImplementation(async () => ({ linkedAt: new Date() }));
});

describe("linkVerifiedSender", () => {
  it("writes a verified org-wide link", async () => {
    const out = await linkVerifiedSender(input);
    expect(out).toMatchObject({ ok: true, displacedUserIds: [] });
    const upsert = tx.userSurfaceIdentity.upsert.mock.calls[0]![0];
    expect(upsert.where.surfaceId_surfaceWorkspaceId_surfaceUserId).toEqual({
      surfaceId: "surface-wa",
      surfaceWorkspaceId: "org-test",
      surfaceUserId: "15555550123",
    });
    expect(upsert.create).toMatchObject({ userId: "user-owner", verifiedAt: expect.any(Date) });
    expect(upsert.update).toMatchObject({ userId: "user-owner", verifiedAt: expect.any(Date) });
  });

  it("verified wins: replaces another user's unverified claim and says whose it was", async () => {
    tx.userSurfaceIdentity.findMany.mockResolvedValue([
      { userId: "user-claimer", status: "ACTIVE", verifiedAt: null },
      { userId: "user-claimer", status: "ACTIVE", verifiedAt: null },
    ]);
    const out = await linkVerifiedSender(input);
    expect(out).toMatchObject({ ok: true, displacedUserIds: ["user-claimer"] });
    // Their legacy per-account rows go too, so nothing keeps pointing at them.
    expect(tx.userSurfaceIdentity.deleteMany).toHaveBeenCalledWith({
      where: {
        surfaceId: "surface-wa",
        orgId: "org-test",
        surfaceUserId: "15555550123",
        userId: { not: "user-owner" },
        surfaceWorkspaceId: { not: "org-test" },
      },
    });
    expect(tx.userSurfaceIdentity.upsert).toHaveBeenCalled();
  });

  it("never overwrites another user's verified link", async () => {
    tx.userSurfaceIdentity.findMany.mockResolvedValue([{ userId: "user-other", status: "ACTIVE", verifiedAt: new Date() }]);
    expect(await linkVerifiedSender(input)).toEqual({ ok: false, reason: "verified_elsewhere" });
    expect(tx.userSurfaceIdentity.deleteMany).not.toHaveBeenCalled();
    expect(tx.userSurfaceIdentity.upsert).not.toHaveBeenCalled();
  });
});
