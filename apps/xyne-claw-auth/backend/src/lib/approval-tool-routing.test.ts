import { describe, expect, it } from "vitest";
import { SDLC_MCP_SERVER_TYPE, SDLC_TOOL_NAMES } from "xyne-claw-shared";
import { approvalServerType, approvalToolFailureMessage } from "./approval-tool-routing.js";

describe("approvalServerType", () => {
  it("routes approvals signed before the split to the SDLC server", () => {
    expect(approvalServerType("xyne-spaces", SDLC_TOOL_NAMES.createTrackFolder)).toBe(SDLC_MCP_SERVER_TYPE);
    expect(approvalServerType(SDLC_MCP_SERVER_TYPE, SDLC_TOOL_NAMES.writeArtifact)).toBe(SDLC_MCP_SERVER_TYPE);
  });

  it("leaves every other tool on its own server", () => {
    expect(approvalServerType("xyne-spaces", "spaces-create-ticket")).toBe("xyne-spaces");
    expect(approvalServerType("jira", SDLC_TOOL_NAMES.writeArtifact)).toBe("jira");
  });
});

describe("approvalToolFailureMessage", () => {
  const stale = "target conversation not found — re-run the agent to regenerate this approval";

  it("explains a missing conversation", () => {
    expect(approvalToolFailureMessage("Conversation not found", {})).toBe(stale);
    expect(approvalToolFailureMessage("Spaces API 404: {}", { conversationId: "c1" })).toBe(stale);
  });

  it("keeps the real error for a 404 from a tool that targets no conversation", () => {
    const text = "SDLC track folder error: Spaces API 404: Cannot POST /api/sdlc/claw/track-folders";
    expect(approvalToolFailureMessage(text, { channelId: "ch", trackId: "t", name: "n" })).toBe(text);
  });
});
