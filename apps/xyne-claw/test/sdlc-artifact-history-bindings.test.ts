import { describe, expect, it } from "vitest";
import { trustedSdlcToolBindings } from "../src/sdlc-wiki-tool-bindings.js";

function context(operation: "interactive" | "wiki") {
  return {
    operation,
    workspaceId: "workspace-1",
    actorUserId: "user-1",
    repository: { id: "repo-1" },
    execution: {
      workflowExecutionId: operation === "wiki" ? "execution-1" : null,
      sessionId: operation === "wiki" ? "session-1" : null,
    },
  };
}

describe("trusted SDLC artifact-history bindings", () => {
  it("binds repository, workspace, and actor identity for interactive history", () => {
    const bindings = trustedSdlcToolBindings(context("interactive"));

    expect(bindings?.["spaces-sdlc-list-artifact-versions"]).toEqual({
      repoId: "repo-1",
      workspaceId: "workspace-1",
      actorUserId: "user-1",
    });
    expect(bindings?.["spaces-sdlc-read-artifact-version"]).toEqual(
      bindings?.["spaces-sdlc-list-artifact-versions"],
    );
    expect(bindings?.["spaces-sdlc-list-artifacts"]).toEqual(
      bindings?.["spaces-sdlc-list-artifact-versions"],
    );
  });

  it("adds execution-bound Wiki identities without weakening history identity", () => {
    const bindings = trustedSdlcToolBindings(context("wiki"));

    expect(bindings?.["spaces-sdlc-read-artifact-version"]).toMatchObject({
      repoId: "repo-1",
      workspaceId: "workspace-1",
      actorUserId: "user-1",
    });
    expect(bindings?.["spaces-sdlc-list-artifacts"]).toEqual({
      repoId: "repo-1",
      workspaceId: "workspace-1",
      actorUserId: "user-1",
      executionId: "execution-1",
      sessionId: "session-1",
    });
    expect(bindings?.["spaces-sdlc-wiki-finalize-commit"]).toEqual({
      executionId: "execution-1", sessionId: "session-1", repoId: "repo-1",
    });
  });

  it("does not bind tools without complete server-owned repository identity", () => {
    expect(trustedSdlcToolBindings({ operation: "interactive" })).toBeUndefined();
  });
});
