import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

let storedOrder: unknown = null;
let readFails = false;
const findUnique = vi.fn(async () => {
  if (readFails) throw new Error("db down");
  return storedOrder === null ? null : { order: storedOrder };
});
vi.mock("../db.js", () => ({ prisma: { deliveryPreference: { findUnique } } }));

const whatsappTarget = { account: { id: "acc-cloud" }, chatId: "910000000001", via: "identity" as const };
let notifyTarget: typeof whatsappTarget | null = null;
const findNotifyTarget = vi.fn(async (..._args: unknown[]) => notifyTarget);
vi.mock("../surfaces/messaging/agent-tools.js", () => ({ findNotifyTarget }));

const {
  deliverInOrder,
  deliveryPlan,
  allowsSurface,
  normalizeDeliveryOrder,
  parseStoredOrder,
  resolveDeliveryTargets,
  scheduledDeliveryTargets,
} = await import("./delivery-preference.js");

beforeEach(() => {
  storedOrder = null;
  readFails = false;
  notifyTarget = null;
  findUnique.mockClear();
  findNotifyTarget.mockClear();
});

describe("normalizeDeliveryOrder", () => {
  it("keeps the person's order and appends Spaces as the last resort", () => {
    expect(normalizeDeliveryOrder(["whatsapp", "teams"])).toEqual({ ok: true, order: ["whatsapp", "teams", "spaces"] });
  });

  it("drops duplicates (first wins) and forgives case and spaces", () => {
    expect(normalizeDeliveryOrder([" WhatsApp", "spaces", "whatsapp", "Spaces"])).toEqual({ ok: true, order: ["whatsapp", "spaces"] });
  });

  it("keeps Spaces where the person put it when they list it", () => {
    expect(normalizeDeliveryOrder(["spaces", "whatsapp"])).toEqual({ ok: true, order: ["spaces", "whatsapp"] });
  });

  it("accepts Teams before the channel exists", () => {
    expect(normalizeDeliveryOrder(["teams"])).toEqual({ ok: true, order: ["teams", "spaces"] });
  });

  it("rejects unknown surfaces instead of silently dropping them", () => {
    const result = normalizeDeliveryOrder(["whatsapp", "telegram"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('"telegram"');
    expect(normalizeDeliveryOrder(["whatsapp", 3]).ok).toBe(false);
  });

  it("rejects a non-array and an oversized list", () => {
    expect(normalizeDeliveryOrder("whatsapp").ok).toBe(false);
    expect(normalizeDeliveryOrder(undefined).ok).toBe(false);
    expect(normalizeDeliveryOrder(Array.from({ length: 21 }, () => "spaces")).ok).toBe(false);
  });

  it("an empty list means Spaces only", () => {
    expect(normalizeDeliveryOrder([])).toEqual({ ok: true, order: ["spaces"] });
  });
});

describe("parseStoredOrder / deliveryPlan", () => {
  it("reads a stored row leniently: unknown keys from another build are skipped", () => {
    expect(parseStoredOrder(["signal", "whatsapp", "whatsapp"])).toEqual(["whatsapp", "spaces"]);
    expect(parseStoredOrder({ not: "a list" })).toBeNull();
  });

  it("no preference returns the flow's legacy order untouched", () => {
    expect(deliveryPlan(null, ["whatsapp"])).toEqual(["whatsapp"]);
    expect(deliveryPlan(null, ["spaces"])).toEqual(["spaces"]);
    expect(deliveryPlan(null, [])).toEqual([]);
  });

  it("a preference replaces the legacy order, Spaces last", () => {
    expect(deliveryPlan(["whatsapp"], ["spaces"])).toEqual(["whatsapp", "spaces"]);
  });

  it("allowsSurface: no preference allows everything; a chosen order only what it lists", () => {
    expect(allowsSurface(null, "whatsapp")).toBe(true);
    expect(allowsSurface(["spaces"], "whatsapp")).toBe(false);
    expect(allowsSurface(["teams", "whatsapp", "spaces"], "whatsapp")).toBe(true);
  });
});

describe("resolveDeliveryTargets", () => {
  const base = { userId: "user-1", orgId: "org-1" };

  it("with no preference keeps today's routing and never looks up WhatsApp for a Spaces flow", async () => {
    notifyTarget = whatsappTarget;
    const resolved = await resolveDeliveryTargets({ ...base, purpose: "message", legacy: ["spaces"] });
    expect(resolved).toEqual({ explicit: false, targets: [{ surface: "spaces" }], skipped: [] });
    expect(findNotifyTarget).not.toHaveBeenCalled();
  });

  it("with no preference a WhatsApp-born flow stays WhatsApp-only (no new Spaces fallback)", async () => {
    notifyTarget = whatsappTarget;
    const resolved = await resolveDeliveryTargets({ ...base, purpose: "message", legacy: ["whatsapp"] });
    expect(resolved.targets).toEqual([{ surface: "whatsapp", whatsapp: whatsappTarget }]);
  });

  it("puts a linked, verified WhatsApp first when chosen, Spaces after it", async () => {
    storedOrder = ["whatsapp", "spaces"];
    notifyTarget = whatsappTarget;
    const resolved = await resolveDeliveryTargets({ ...base, purpose: "message", legacy: ["spaces"] });
    expect(resolved.explicit).toBe(true);
    expect(resolved.targets.map((t) => t.surface)).toEqual(["whatsapp", "spaces"]);
    expect(findNotifyTarget).toHaveBeenCalledWith("user-1", "org-1", { verifiedIdentityOnly: false });
  });

  it("skips Teams as unavailable and an unlinked WhatsApp, landing on Spaces", async () => {
    storedOrder = ["teams", "whatsapp"];
    const resolved = await resolveDeliveryTargets({ ...base, purpose: "message", legacy: ["spaces"] });
    expect(resolved.targets).toEqual([{ surface: "spaces" }]);
    expect(resolved.skipped).toEqual([
      { surface: "teams", reason: "unavailable" },
      { surface: "whatsapp", reason: "not_linked" },
    ]);
  });

  it("asks for a code-verified number only when the purpose is an approval", async () => {
    storedOrder = ["whatsapp"];
    await resolveDeliveryTargets({ ...base, purpose: "approval", legacy: [] });
    expect(findNotifyTarget).toHaveBeenCalledWith("user-1", "org-1", { verifiedIdentityOnly: true });
  });

  it("a failed preference read falls back to the legacy routing, not to nothing", async () => {
    readFails = true;
    const resolved = await resolveDeliveryTargets({ ...base, purpose: "message", legacy: ["spaces"] });
    expect(resolved).toEqual({ explicit: false, targets: [{ surface: "spaces" }], skipped: [] });
  });

  it("an explicit null preference (channel broadcast) ignores the stored order", async () => {
    storedOrder = ["whatsapp"];
    notifyTarget = whatsappTarget;
    const resolved = await scheduledDeliveryTargets({
      ...base,
      replyMode: "channel",
      targetChannelId: null,
      channelId: "chan-1",
    });
    expect(resolved.targets).toEqual([{ surface: "spaces" }]);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("a scheduled thread job follows the stored order", async () => {
    storedOrder = ["whatsapp"];
    notifyTarget = whatsappTarget;
    const resolved = await scheduledDeliveryTargets({ ...base, replyMode: "thread", targetChannelId: null, channelId: "chan-1" });
    expect(resolved.targets.map((t) => t.surface)).toEqual(["whatsapp", "spaces"]);
  });
});

describe("deliverInOrder — fallback order", () => {
  const targets = [{ surface: "whatsapp" as const }, { surface: "teams" as const }, { surface: "spaces" as const }];

  it("stops at the first surface that sends", async () => {
    const send = vi.fn(async () => ({ ok: true as const }));
    expect(await deliverInOrder(targets, send)).toEqual({ ok: true, surface: "whatsapp", failed: [] });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("falls through a failed and a throwing surface to Spaces", async () => {
    const tried: string[] = [];
    const result = await deliverInOrder(targets, async (t) => {
      tried.push(t.surface);
      if (t.surface === "whatsapp") return { ok: false, error: "outside the 24h window" };
      if (t.surface === "teams") throw new Error("socket closed");
      return { ok: true };
    });
    expect(tried).toEqual(["whatsapp", "teams", "spaces"]);
    expect(result).toEqual({
      ok: true,
      surface: "spaces",
      failed: [
        { surface: "whatsapp", error: "outside the 24h window" },
        { surface: "teams", error: "socket closed" },
      ],
    });
  });

  it("reports every failure when nothing sends", async () => {
    const result = await deliverInOrder(targets.slice(0, 1), async () => ({ ok: false, error: "nope" }));
    expect(result).toEqual({ ok: false, failed: [{ surface: "whatsapp", error: "nope" }] });
    expect(await deliverInOrder([], async () => ({ ok: true }))).toEqual({ ok: false, failed: [] });
  });
});
