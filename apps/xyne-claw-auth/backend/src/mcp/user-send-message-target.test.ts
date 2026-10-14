import { describe, expect, it } from "vitest";
import { resolveUserSendMessageTarget } from "./user-send-message-target.js";

describe("resolveUserSendMessageTarget", () => {
  it.each([
    [{ channelId: " channel_1 " }, { kind: "channel", id: "channel_1" }],
    [{ conversationId: "conversation_1" }, { kind: "conversation", id: "conversation_1" }],
    [{ recipientUserId: " user_2 " }, { kind: "recipient", id: "user_2" }],
    [{}, { kind: "unknown", id: "" }],
  ])("resolves an approval destination from %o", (params, expected) => {
    expect(resolveUserSendMessageTarget(params)).toEqual(expected);
  });
});
