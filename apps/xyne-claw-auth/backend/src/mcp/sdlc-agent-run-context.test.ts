import { describe, expect, it } from "vitest";

import { parseSdlcAgentRunContext } from "./sdlc-agent-run-context.js";

const hub = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  channelId: "channel-1",
  actorUserId: "user-1",
  execution: {
    conversationId: "conversation-1",
    linked: { section: "TRACK", id: "track-1", name: "Payments", relation: "DISCUSSION" },
  },
};

describe("SDLC agent run context", () => {
  it("accepts a hub context with its linked item", () => {
    expect(parseSdlcAgentRunContext(hub)).toEqual(hub);
  });

  it("accepts a repository context and one from an older Spaces that still sends retired fields", () => {
    const repository = { id: "repo-1", name: "repo", url: "https://github.com/acme/repo.git", baseBranch: "main" };
    expect(parseSdlcAgentRunContext({ ...hub, repository })).not.toBeNull();
    expect(parseSdlcAgentRunContext({ ...hub, version: 1, operation: "interactive", interactiveGrant: "g" })).not.toBeNull();
  });

  it("rejects incomplete contexts", () => {
    expect(parseSdlcAgentRunContext({ ...hub, actorUserId: undefined })).toBeNull();
    expect(parseSdlcAgentRunContext({ ...hub, execution: {} })).toBeNull();
  });
});
