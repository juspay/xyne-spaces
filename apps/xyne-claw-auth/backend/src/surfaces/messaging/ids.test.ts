import { describe, expect, it } from "vitest";
import { channelConversationId, channelOfConversationId } from "./ids.js";

describe("channelConversationId", () => {
  it("keeps a WhatsApp chat id verbatim (existing conversations keep their ids)", () => {
    expect(channelConversationId("whatsapp", "acct_0123456789abcdef01234567", "assistant", "919876543210@s.whatsapp.net")).toBe(
      "whatsapp-acct_0123456789abcdef01234567-assistant-919876543210_s_whatsapp_net",
    );
  });

  it("hashes a long Teams conversation id so the result fits claw's 128-character limit", () => {
    const chatId = `a:${"x".repeat(120)}`;
    const id = channelConversationId("teams", "acct_0123456789abcdef01234567", "assistant", chatId);
    expect(id.length).toBeLessThanOrEqual(128);
    expect(id).toMatch(/^teams-acct_0123456789abcdef01234567-assistant-h[0-9a-f]{32}$/);
    expect(channelOfConversationId(id)).toBe("teams");
  });

  it("keeps two channel threads apart, and one thread stable", () => {
    const thread = (root: string) => `19:${"c".repeat(40)}@thread.tacv2;messageid=${root}`;
    const a = channelConversationId("teams", "acct_1", "assistant", thread("1700000000001"));
    const b = channelConversationId("teams", "acct_1", "assistant", thread("1700000000002"));
    expect(a).not.toBe(b);
    expect(channelConversationId("teams", "acct_1", "assistant", thread("1700000000001"))).toBe(a);
  });
});
