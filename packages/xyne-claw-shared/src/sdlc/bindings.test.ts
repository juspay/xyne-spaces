import { describe, expect, it } from "vitest";
import { trustedSdlcToolBindings } from "./bindings.js";
import { packSdlcRunMeta } from "./meta.js";
import { SDLC_TOOL_NAMES } from "./registry.js";

const context = {
  version: 1,
  operation: "interactive",
  workspaceId: "workspace-1",
  projectId: "project-1",
  channelId: "channel-1",
  actorUserId: "user-1",
  execution: { conversationId: "conversation-1" },
};

describe("SDLC trusted bindings", () => {
  it("binds nothing without backend context", () => {
    expect(trustedSdlcToolBindings(undefined)).toBeUndefined();
    expect(trustedSdlcToolBindings({ channelId: "channel-1" })).toBeUndefined();
  });

  it("binds only the Actor to pull requests, leaving the repository to the call", () => {
    const bindings = trustedSdlcToolBindings(context);
    expect(bindings?.[SDLC_TOOL_NAMES.createPullRequest]).toEqual({
      workspaceId: "workspace-1",
      actorUserId: "user-1",
    });
    expect(bindings?.[SDLC_TOOL_NAMES.listEntityLinks]).toEqual({
      workspaceId: "workspace-1",
      actorUserId: "user-1",
      channelId: "channel-1",
    });
  });

  it("packs the Actor for sdlc-repository-access and nothing credential-shaped", () => {
    expect(packSdlcRunMeta({ ...context, interactiveGrant: "grant-1" })).toEqual({
      sdlcChannelId: "channel-1",
      sdlcWorkspaceId: "workspace-1",
      sdlcActorUserId: "user-1",
    });
  });
});
