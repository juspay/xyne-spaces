import { describe, expect, it } from "vitest";
import { orderDeliveryTargets, type DeliveryCandidate } from "./delivery-order.js";

const now = new Date("2026-10-11T02:32:00Z");
const limits = { cloudWindowMs: 23 * 3_600_000, activeChatMs: 7 * 24 * 3_600_000 };
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const c = (channel: DeliveryCandidate<string>["channel"], seen: Date | null): DeliveryCandidate<string> => ({
  account: channel,
  channel,
  senderId: "91999",
  lastSeenAt: seen,
});

describe("orderDeliveryTargets", () => {
  it("prefers the channel the user used most recently", () => {
    const { usable } = orderDeliveryTargets([c("whatsapp", hoursAgo(30)), c("whatsapp-cloud", hoursAgo(2))], now, limits);
    expect(usable.map((u) => u.channel)).toEqual(["whatsapp-cloud", "whatsapp"]);
  });

  it("skips a Baileys number the user has not used for a week", () => {
    const { usable, reason } = orderDeliveryTargets([c("whatsapp", hoursAgo(24 * 9))], now, limits);
    expect(usable).toEqual([]);
    expect(reason).toBe("chat_inactive");
  });

  it("reports the Cloud window when the user has gone quiet on Cloud", () => {
    const { usable, reason } = orderDeliveryTargets([c("whatsapp-cloud", hoursAgo(60)), c("whatsapp", hoursAgo(24 * 9))], now, limits);
    expect(usable).toEqual([]);
    expect(reason).toBe("outside_cloud_window");
  });

  it("reports an unlinked user", () => {
    expect(orderDeliveryTargets([], now, limits).reason).toBe("user_not_linked");
  });
});
