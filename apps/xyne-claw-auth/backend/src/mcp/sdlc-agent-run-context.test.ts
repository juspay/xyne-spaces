import { describe, expect, it } from "vitest";

import { parseSdlcAgentRunContext } from "./sdlc-agent-run-context.js";

const pinned = {
  version: 1,
  operation: "interactive",
  workspaceId: "workspace-1",
  projectId: "project-1",
  channelId: "channel-1",
  actorUserId: "user-1",
  repository: { id: "repo-1", name: "repo", url: "https://github.com/acme/repo.git", baseBranch: "main" },
  execution: { conversationId: "conversation-1" },
  interactiveGrant: "grant-1",
};

describe("SDLC agent run context", () => {
  it("accepts a trusted interactive context", () => {
    expect(parseSdlcAgentRunContext(pinned)).toEqual(pinned);
  });

  it("accepts a context without the retired grant", () => {
    const { interactiveGrant: _grant, ...withoutGrant } = pinned;
    expect(parseSdlcAgentRunContext(withoutGrant)).toEqual(withoutGrant);
  });

  it("rejects incomplete or retired contexts", () => {
    expect(parseSdlcAgentRunContext({ ...pinned, repository: { ...pinned.repository, id: "" } })).toBeNull();
    expect(parseSdlcAgentRunContext({ ...pinned, actorUserId: undefined })).toBeNull();
    expect(parseSdlcAgentRunContext({ ...pinned, operation: "baseline" })).toBeNull();
  });
});
