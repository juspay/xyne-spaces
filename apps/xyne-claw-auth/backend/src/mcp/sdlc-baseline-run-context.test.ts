import { describe, expect, it } from "vitest";
import { SDLC_BASELINE_KINDS } from "@xyne/shared/sdlc";
import {
  injectSdlcBaselineRunContext,
  parseSdlcAgentRunContext,
} from "./sdlc-baseline-run-context.js";

function context(baselineKind: string) {
  return {
    version: 1,
    operation: "baseline",
    workspaceId: "workspace-1",
    projectId: "project-1",
    channelId: "channel-1",
    actorUserId: "user-1",
    repository: { id: "repo-1", name: "Repo", url: "https://github.com/acme/repo.git", baseBranch: "main" },
    permissions: { repositoryRole: "ADMIN" },
    gates: { capabilities: [], allBaselinesApproved: false },
    execution: { workflowExecutionId: "execution-1", sessionId: "session-1", conversationId: "conversation-1" },
    artifact: { kind: null, id: null, sourceType: null, sourceId: null },
    ticketId: null,
    setupExecutionId: "execution-1",
    baselineKind,
  };
}

describe("SDLC baseline trusted run context", () => {
  it.each(SDLC_BASELINE_KINDS)("accepts and injects %s", baselineKind => {
    const sdlcContext = context(baselineKind);
    expect(parseSdlcAgentRunContext(sdlcContext)).not.toBeNull();
    expect(
      injectSdlcBaselineRunContext(
        { artifactType: "BASELINE", action: "begin" },
        { sdlcContext }
      )
    ).toMatchObject({
      repoId: "repo-1",
      setupExecutionId: "execution-1",
      workflowExecutionId: "execution-1",
      baselineKind,
    });
  });

  it("accepts interactive context only with conversation-bound authority", () => {
    const base = context("CORE_CODE_MAP");
    const interactive = {
      ...base,
      operation: "interactive",
      interactiveGrant: "signed-grant",
      execution: {
        workflowExecutionId: null,
        sessionId: null,
        conversationId: "conversation-1",
      },
    };

    expect(parseSdlcAgentRunContext(interactive)).not.toBeNull();
    expect(parseSdlcAgentRunContext({ ...interactive, interactiveGrant: null })).toBeNull();
  });
});
