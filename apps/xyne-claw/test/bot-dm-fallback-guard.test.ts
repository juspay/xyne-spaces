import { describe, expect, it } from "vitest";
import {
  BOT_DM_FALLBACK_REASON,
  isBotDmSendFailure,
  withUserSendFallbackReason,
} from "../src/bot-dm-fallback-guard.js";

describe("bot DM fallback guard", () => {
  it("detects failed apps-send-message bot DMs", () => {
    expect(isBotDmSendFailure(
      "xyne-spaces-app-tools",
      "apps-send-message",
      { targetUserId: "user_1", content: "please review" },
      "apps-send-message error: Spaces app API 500",
    )).toBe(true);
  });

  it("does not treat non-DM app sends as bot-DM fallback context", () => {
    expect(isBotDmSendFailure(
      "xyne-spaces-app-tools",
      "apps-send-message",
      { channelId: "channel_1", content: "please review" },
      "apps-send-message error: Spaces app API 500",
    )).toBe(false);
  });

  it("adds fallbackReason to a later user-send-message approval payload", () => {
    const params = withUserSendFallbackReason(
      "xyne-spaces",
      "user-send-message",
      { channelId: "channel_1", content: "please review" },
      BOT_DM_FALLBACK_REASON,
    );

    expect(params).toMatchObject({ fallbackReason: BOT_DM_FALLBACK_REASON });
  });

  it("preserves an explicit fallbackReason supplied by the agent", () => {
    const params = withUserSendFallbackReason(
      "xyne-spaces",
      "user-send-message",
      { channelId: "channel_1", content: "please review", fallbackReason: "Bot DM failed with 500" },
      BOT_DM_FALLBACK_REASON,
    );

    expect(params.fallbackReason).toBe("Bot DM failed with 500");
  });
});
