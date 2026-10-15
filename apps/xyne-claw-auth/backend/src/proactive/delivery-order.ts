import type { MessagingChannelKey } from "../surfaces/messaging/plugin.js";

export interface DeliveryCandidate<A> {
  account: A;
  channel: MessagingChannelKey;
  senderId: string;
  lastSeenAt: Date | null;
}

export function orderDeliveryTargets<A>(
  candidates: DeliveryCandidate<A>[],
  now: Date,
  limits: { cloudWindowMs: number; activeChatMs: number },
): { usable: DeliveryCandidate<A>[]; reason: string } {
  if (candidates.length === 0) return { usable: [], reason: "user_not_linked" };
  const age = (c: DeliveryCandidate<A>) => (c.lastSeenAt ? now.getTime() - c.lastSeenAt.getTime() : Number.POSITIVE_INFINITY);
  const usable = candidates
    .filter((c) => age(c) <= (c.channel === "whatsapp-cloud" ? limits.cloudWindowMs : limits.activeChatMs))
    .sort((a, b) => age(a) - age(b));
  if (usable.length > 0) return { usable, reason: "no_channel" };
  return { usable, reason: candidates.some((c) => c.channel === "whatsapp-cloud") ? "outside_cloud_window" : "chat_inactive" };
}
