import { describe, expect, it } from "vitest";

import { injectSdlcBaselineRunContext, parseSdlcAgentRunContext } from "./sdlc-baseline-run-context.js";

const pinned = {
  version: 1,
  operation: "baseline",
  workspaceId: "workspace-1",
  projectId: "project-1",
  channelId: "channel-1",
  actorUserId: "user-1",
  repository: { id: "repo-1", name: "repo", url: "https://github.com/acme/repo.git", baseBranch: "main" },
  permissions: { repositoryRole: "ADMIN", writeRequested: false },
  gates: { accessStatus: "VALID", accessCredentialRevision: 1, capabilities: [], allBaselinesApproved: false },
  execution: { workflowExecutionId: "setup-1", sessionId: "session-1", conversationId: null },
  artifact: { kind: null, id: null, sourceType: null, sourceId: null },
  ticketId: null,
  setupExecutionId: "setup-1",
  baselineKind: "CORE_CODE_MAP",
};

describe("SDLC baseline run context", () => {
  it("force-injects persisted identifiers when the model omits them after compaction", () => {
    expect(
      injectSdlcBaselineRunContext(
        { action: "upsert_section", sectionKey: "architecture" },
        { sdlcContext: pinned },
      ),
    ).toEqual({
      action: "upsert_section",
      sectionKey: "architecture",
      repoId: "repo-1",
      setupExecutionId: "setup-1",
      workflowExecutionId: "setup-1",
      baselineKind: "CORE_CODE_MAP",
    });
  });

  it("overwrites hallucinated identifiers with persisted run values", () => {
    expect(
      injectSdlcBaselineRunContext(
        { action: "finalize", repoId: "juspay/hyperswitch", workflowExecutionId: "wrong" },
        { sdlcContext: pinned },
      ),
    ).toEqual({
      action: "finalize",
      repoId: "repo-1",
      setupExecutionId: "setup-1",
      workflowExecutionId: "setup-1",
      baselineKind: "CORE_CODE_MAP",
    });
  });

  it("rejects incomplete persisted context", () => {
    expect(parseSdlcAgentRunContext({ ...pinned, repository: { ...pinned.repository, id: "" } })).toBeNull();
    expect(parseSdlcAgentRunContext({ ...pinned, gates: { ...pinned.gates, capabilities: null } })).toBeNull();
  });

  it("rejects operation/context mismatches", () => {
    expect(parseSdlcAgentRunContext({
      ...pinned,
      operation: "work",
      ticketId: "ticket-1",
      permissions: { ...pinned.permissions, writeRequested: false },
    })).toBeNull();
    expect(parseSdlcAgentRunContext({
      ...pinned,
      operation: "interactive",
      execution: { ...pinned.execution, conversationId: null },
    })).toBeNull();
  });
});
