import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/surface-resolver.js", () => ({ decryptSurfaceSecret: vi.fn(), encryptSurfaceSecret: vi.fn() }));

const identities = vi.hoisted(() => ({ findFirst: vi.fn(), upsert: vi.fn() }));
vi.mock("../../db.js", () => ({ prisma: { userSurfaceIdentity: identities } }));

const { linkVerifiedSender } = await import("./store.js");

const input = { surfaceId: "surface-wa", senderId: "15555550123", orgId: "org-test", userId: "user-owner" };

beforeEach(() => {
  vi.clearAllMocks();
  identities.findFirst.mockResolvedValue(null);
  identities.upsert.mockImplementation(async () => ({ linkedAt: new Date() }));
});

describe("linkVerifiedSender", () => {
  it("writes an org-wide link", async () => {
    const out = await linkVerifiedSender(input);
    expect(out).toMatchObject({ ok: true, linkedAt: expect.any(Date) });
    const upsert = identities.upsert.mock.calls[0]![0];
    expect(upsert.where.surfaceId_surfaceWorkspaceId_surfaceUserId).toEqual({
      surfaceId: "surface-wa",
      surfaceWorkspaceId: "org-test",
      surfaceUserId: "15555550123",
    });
    expect(upsert.create).toMatchObject({ userId: "user-owner", status: "ACTIVE" });
    expect(upsert.update).toMatchObject({ userId: "user-owner", status: "ACTIVE" });
  });

  it("never overwrites somebody else's link", async () => {
    identities.findFirst.mockResolvedValue({ id: "row-other" });
    expect(await linkVerifiedSender(input)).toEqual({ ok: false, reason: "linked_elsewhere" });
    expect(identities.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ surfaceUserId: "15555550123", status: "ACTIVE", userId: { not: "user-owner" } }),
      }),
    );
    expect(identities.upsert).not.toHaveBeenCalled();
  });
});
