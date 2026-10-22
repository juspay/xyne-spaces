import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyChannelPlugin } from "./plugin.js";

vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const findFirst = vi.fn();
vi.mock("../../db.js", () => ({
  prisma: { userSurfaceIdentity: { findFirst, update: vi.fn(() => Promise.resolve()) } },
}));

const writeAuditLog = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("../../lib/audit.js", () => ({ writeAuditLog }));

const verification = vi.hoisted(() => ({
  checkCode: vi.fn(),
  issueCode: vi.fn(),
  sendCode: vi.fn(),
  findCodeSender: vi.fn(),
  withdrawCode: vi.fn(async () => undefined),
}));
vi.mock("./number-verification.js", () => verification);

const cloud = {
  key: "whatsapp-cloud",
  displayName: "WhatsApp Business",
  accountScope: "org" as const,
  senderIdFromPhone: (phone: string) => phone.replace(/\D/g, "") || null,
};
const personal = {
  key: "whatsapp",
  displayName: "WhatsApp",
  accountScope: "user" as const,
  senderIdFromPhone: (phone: string) => `${phone.replace(/\D/g, "")}@s.whatsapp.net`,
};
vi.mock("./plugin.js", () => ({ listChannels: () => [cloud, personal] }));

const store = vi.hoisted(() => ({
  getSurface: vi.fn(async (key: string) => ({ id: `surface-${key}`, status: "ACTIVE" })),
  isVerifiedByAnotherUser: vi.fn(async () => false),
  linkVerifiedSender: vi.fn(),
  listOrgAccounts: vi.fn(async () => [{ config: { displayId: "+1 555 555 0100" } }]),
  toChannelAccount: (row: unknown) => row,
}));
vi.mock("./store.js", () => store);

const { confirmNumber, requestNumberCode, resolveIdentity, LinkError } = await import("./identity.js");

// Obviously fake numbers (555-01xx is reserved for fiction).
const PHONE = "+1 555 555 0123";
const DIGITS = "15555550123";
const base = { plugin: cloud as unknown as AnyChannelPlugin, orgId: "org-test", phone: PHONE, userId: "user-owner" };
const linkedAt = new Date("2026-01-01T00:00:00Z");

async function rejection(promise: Promise<unknown>): Promise<InstanceType<typeof LinkError>> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(LinkError);
  return err as InstanceType<typeof LinkError>;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.isVerifiedByAnotherUser.mockResolvedValue(false);
  store.linkVerifiedSender.mockResolvedValue({ ok: true, linkedAt, displacedUserIds: [] });
  verification.findCodeSender.mockResolvedValue({ plugin: cloud, account: { id: "biz" } });
  verification.issueCode.mockResolvedValue({ ok: true, code: "424242", expiresAt: new Date(Date.now() + 600_000) });
  verification.sendCode.mockResolvedValue({ ok: true });
});

describe("resolveIdentity", () => {
  it("only answers to verified links, so an old face-value claim runs as nobody", async () => {
    findFirst.mockResolvedValue(null);
    expect(await resolveIdentity({ surfaceId: "s", senderId: DIGITS, orgId: "org-test" })).toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ verifiedAt: { not: null } }) }),
    );
  });
});

describe("requestNumberCode", () => {
  it("sends a code to the number and links nothing yet", async () => {
    const out = await requestNumberCode({ ...base, surfaceId: "surface-whatsapp-cloud" });
    expect(out.expiresAt).toBeInstanceOf(Date);
    expect(verification.issueCode).toHaveBeenCalledWith({ orgId: "org-test", userId: "user-owner", digits: DIGITS });
    expect(verification.sendCode).toHaveBeenCalledWith(expect.objectContaining({ account: { id: "biz" } }), DIGITS, "424242");
    expect(store.linkVerifiedSender).not.toHaveBeenCalled();
  });

  it("refuses a number someone else has verified, before sending anything", async () => {
    store.isVerifiedByAnotherUser.mockResolvedValue(true);
    const err = await rejection(requestNumberCode({ ...base, surfaceId: "surface-whatsapp-cloud" }));
    expect(err.status).toBe(409);
    expect(verification.issueCode).not.toHaveBeenCalled();
  });

  it("says so when the org has no business number to send from", async () => {
    verification.findCodeSender.mockResolvedValue(null);
    expect((await rejection(requestNumberCode({ ...base, surfaceId: "s" }))).status).toBe(409);
  });

  it("passes rate limits through as 429", async () => {
    verification.issueCode.mockResolvedValue({ ok: false, reason: "rate_limited", scope: "number" });
    const err = await rejection(requestNumberCode({ ...base, surfaceId: "s" }));
    expect(err.status).toBe(429);
    expect(verification.sendCode).not.toHaveBeenCalled();
  });

  it("fails closed when the code cannot be stored", async () => {
    verification.issueCode.mockRejectedValue(new Error("redis down"));
    expect((await rejection(requestNumberCode({ ...base, surfaceId: "s" }))).status).toBe(503);
    expect(verification.sendCode).not.toHaveBeenCalled();
  });

  it("withdraws a code that never reached the phone", async () => {
    verification.sendCode.mockResolvedValue({ ok: false, error: "(#131047) Re-engagement message" });
    const err = await rejection(requestNumberCode({ ...base, surfaceId: "s" }));
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/template/);
    expect(verification.withdrawCode).toHaveBeenCalledWith({ orgId: "org-test", userId: "user-owner", digits: DIGITS });
  });

  it("rejects input that is not a phone number", async () => {
    expect((await rejection(requestNumberCode({ ...base, phone: "not a phone", surfaceId: "s" }))).status).toBe(400);
  });
});

describe("confirmNumber", () => {
  it("a wrong code links nothing and says how many tries are left", async () => {
    verification.checkCode.mockResolvedValue({ outcome: "wrong", attemptsLeft: 2 });
    const err = await rejection(confirmNumber({ ...base, code: "000000" }));
    expect(err.status).toBe(400);
    expect(err.message).toContain("2 tries left");
    expect(store.linkVerifiedSender).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("an expired (or already used) code links nothing", async () => {
    verification.checkCode.mockResolvedValue({ outcome: "expired" });
    expect((await rejection(confirmNumber({ ...base, code: "424242" }))).status).toBe(410);
    expect(store.linkVerifiedSender).not.toHaveBeenCalled();
  });

  it("a burned challenge links nothing", async () => {
    verification.checkCode.mockResolvedValue({ outcome: "locked" });
    expect((await rejection(confirmNumber({ ...base, code: "424242" }))).status).toBe(429);
    expect(store.linkVerifiedSender).not.toHaveBeenCalled();
  });

  it("the right code links the number on every channel that can see it, and audits each", async () => {
    verification.checkCode.mockResolvedValue({ outcome: "ok" });
    const linked = await confirmNumber({ ...base, code: "424242" });
    expect(linked).toEqual({ senderId: DIGITS, sendTo: "+1 555 555 0100", linkedAt });
    expect(verification.checkCode).toHaveBeenCalledWith({ orgId: "org-test", userId: "user-owner", digits: DIGITS }, "424242");
    expect(store.linkVerifiedSender).toHaveBeenCalledWith({
      surfaceId: "surface-whatsapp-cloud",
      senderId: DIGITS,
      orgId: "org-test",
      userId: "user-owner",
    });
    expect(store.linkVerifiedSender).toHaveBeenCalledWith(
      expect.objectContaining({ surfaceId: "surface-whatsapp", senderId: `${DIGITS}@s.whatsapp.net` }),
    );
    const events = writeAuditLog.mock.calls.map(([entry]) => (entry as { eventType: string }).eventType);
    expect(events).toEqual(["CHANNEL_NUMBER_LINKED", "CHANNEL_NUMBER_LINKED"]);
  });

  it("reclaims a number someone else claimed without verifying, and audits who lost it", async () => {
    verification.checkCode.mockResolvedValue({ outcome: "ok" });
    store.linkVerifiedSender.mockResolvedValue({ ok: true, linkedAt, displacedUserIds: ["user-claimer"] });
    await confirmNumber({ ...base, code: "424242" });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "CHANNEL_NUMBER_RECLAIMED",
        actorUserId: "user-owner",
        targetId: DIGITS,
        metadata: expect.objectContaining({ previousUserId: "user-claimer", newUserId: "user-owner", orgId: "org-test" }),
      }),
    );
  });

  it("never takes over somebody else's verified link", async () => {
    verification.checkCode.mockResolvedValue({ outcome: "ok" });
    store.linkVerifiedSender.mockResolvedValue({ ok: false, reason: "verified_elsewhere" });
    expect((await rejection(confirmNumber({ ...base, code: "424242" }))).status).toBe(409);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
