import { describe, expect, it } from "vitest";
import { trustedSdlcToolBindings } from "./bindings.js";
import { packSdlcRunMeta } from "./meta.js";
import { SDLC_DIRECT_TOOL_NAMES, SDLC_TOOL_NAMES } from "./registry.js";

const context = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  channelId: "channel-1",
  actorUserId: "user-1",
  execution: { conversationId: "conversation-1", linked: null },
};

describe("SDLC trusted bindings", () => {
  it("binds nothing without backend context", () => {
    expect(trustedSdlcToolBindings(undefined)).toBeUndefined();
    expect(trustedSdlcToolBindings({ channelId: "channel-1" })).toBeUndefined();
  });

  it("pins only the Actor on every SDLC tool, leaving hub and repository to the call", () => {
    const bindings = trustedSdlcToolBindings(context);
    for (const name of SDLC_DIRECT_TOOL_NAMES) {
      expect(bindings?.[name]).toEqual({ workspaceId: "workspace-1", actorUserId: "user-1" });
    }
    expect(bindings?.[SDLC_TOOL_NAMES.listRepositories]).not.toHaveProperty("channelId");
  });

  it("pins a workflow's generation commit on writes only", () => {
    const bindings = trustedSdlcToolBindings({ ...context, generationCommit: "abc123" });
    expect(bindings?.[SDLC_TOOL_NAMES.writeArtifact]).toEqual({
      workspaceId: "workspace-1",
      actorUserId: "user-1",
      generationCommit: "abc123",
    });
    expect(bindings?.[SDLC_TOOL_NAMES.readArtifact]).not.toHaveProperty("generationCommit");
  });

  it("packs the Actor for sdlc-repository-access and nothing credential-shaped", () => {
    expect(packSdlcRunMeta(context)).toEqual({
      sdlcChannelId: "channel-1",
      sdlcWorkspaceId: "workspace-1",
      sdlcActorUserId: "user-1",
    });
  });
});
