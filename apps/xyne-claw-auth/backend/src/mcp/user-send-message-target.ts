export type UserSendMessageTarget =
  | { kind: "channel"; id: string }
  | { kind: "conversation"; id: string }
  | { kind: "recipient"; id: string }
  | { kind: "unknown"; id: "" };

function stringParam(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Single source of truth for the destination shown on every write-approval surface. */
export function resolveUserSendMessageTarget(
  params: Record<string, unknown>,
): UserSendMessageTarget {
  const channelId = stringParam(params["channelId"]);
  if (channelId) return { kind: "channel", id: channelId };

  const conversationId = stringParam(params["conversationId"]);
  if (conversationId) return { kind: "conversation", id: conversationId };

  const recipientUserId = stringParam(params["recipientUserId"]);
  if (recipientUserId) return { kind: "recipient", id: recipientUserId };

  return { kind: "unknown", id: "" };
}
