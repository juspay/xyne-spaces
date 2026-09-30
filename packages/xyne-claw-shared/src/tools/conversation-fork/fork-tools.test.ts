import { describe, expect, it } from "vitest";
import { getCustomTool } from "../registry.js";
import { FORK_TO_CONVERSATION_TOOL, forkToConversationTool } from "./tools.js";

describe("forkToConversationTool", () => {
  it("is a registered approval-gated agent-tools write", () => {
    expect(forkToConversationTool.slug).toBe(FORK_TO_CONVERSATION_TOOL);
    expect(forkToConversationTool.source).toBe("custom:agent-tools");
    expect(forkToConversationTool.isWriteTool).toBe(true);
    expect(getCustomTool(FORK_TO_CONVERSATION_TOOL)).toBe(forkToConversationTool);
  });

  it("requires a summary and offers both targets", () => {
    expect(forkToConversationTool.inputSchema.required).toEqual(["summary"]);
    expect(Object.keys(forkToConversationTool.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["conversationId", "channelId", "summary"]),
    );
  });

  it("never posts from its fallback execute body", async () => {
    expect((await forkToConversationTool.execute({ channelId: "c", summary: "s" })).toLowerCase()).toContain("approve");
  });
});
