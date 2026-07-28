import { describe, it, expect } from "vitest";
import { resolveTwinReplyTarget } from "./twin-reply-target.js";

// resolveTwinReplyTarget is the pure destination-routing core shared by the
// (legacy) approval-DM handler and the new in-thread reply-draft endpoint.

const ids = {
  targetChannelId: "ch_origin",
  targetConversationId: "conv_origin",
  destinationChannelId: "ch_other",
  destinationConversationId: "conv_other",
};

describe("resolveTwinReplyTarget", () => {
  it("origin_thread → origin channel + conversation", () => {
    expect(resolveTwinReplyTarget("origin_thread", ids)).toEqual({ channelId: "ch_origin", conversationId: "conv_origin" });
  });

  it("origin_channel → origin channel, NO conversation (new top-level message)", () => {
    expect(resolveTwinReplyTarget("origin_channel", ids)).toEqual({ channelId: "ch_origin" });
  });

  it("channel → the resolved destination channel, no conversation", () => {
    expect(resolveTwinReplyTarget("channel", ids)).toEqual({ channelId: "ch_other" });
  });

  it("channel with NO destinationChannelId falls back to origin channel", () => {
    expect(resolveTwinReplyTarget("channel", { ...ids, destinationChannelId: undefined })).toEqual({ channelId: "ch_origin" });
  });

  it("thread → destination channel + conversation when both present", () => {
    expect(resolveTwinReplyTarget("thread", ids)).toEqual({ channelId: "ch_other", conversationId: "conv_other" });
  });

  it("thread missing one id falls back to the origin thread", () => {
    expect(resolveTwinReplyTarget("thread", { ...ids, destinationConversationId: undefined })).toEqual({ channelId: "ch_origin", conversationId: "conv_origin" });
  });

  it("an unknown kind degrades to the origin thread (post-as-user is the real gate)", () => {
    expect(resolveTwinReplyTarget("nonsense", ids)).toEqual({ channelId: "ch_origin", conversationId: "conv_origin" });
  });
});
