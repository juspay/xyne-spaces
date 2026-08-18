import { describe, expect, it } from "vitest";
import { applyTrustedMcpBindings, schemaWithTrustedMcpBindings } from "../src/mcp.js";
import { SDLC_DIRECT_TOOL_NAMES } from "xyne-claw-shared";
import { trustedSdlcToolBindings, trustedSdlcWikiToolBindings } from "../src/sdlc-wiki-tool-bindings.js";

describe("trusted MCP bindings", () => {
  const bindings = {
    executionId: "execution-1",
    sessionId: "session-1",
    repoId: "repo-1",
  };

  it("removes server-bound fields from the model-required schema", () => {
    const schema = schemaWithTrustedMcpBindings(
      {
        type: "object",
        properties: {
          executionId: { type: "string" },
          sessionId: { type: "string" },
          repoId: { type: "string" },
          path: { type: "string" },
        },
        required: ["executionId", "sessionId", "repoId", "path"],
      },
      bindings,
    );

    expect(schema.required).toEqual(["path"]);
  });

  it("overrides missing or hallucinated identity fields before dispatch", () => {
    expect(
      applyTrustedMcpBindings(
        {
          executionId: "wrong-execution",
          sessionId: "wrong-session",
          path: "overview.md",
        },
        bindings,
      ),
    ).toEqual({ ...bindings, path: "overview.md" });
  });

  it("derives every Wiki tool binding only from complete trusted Wiki context", () => {
    const result = trustedSdlcWikiToolBindings({
      operation: "wiki",
      execution: { workflowExecutionId: "execution-1", sessionId: "session-1" },
      repository: { id: "repo-1" },
    });

    expect(Object.keys(result ?? {})).toHaveLength(3);
    expect(result?.["spaces-sdlc-wiki-begin-checkpoint"]).toEqual(bindings);
    expect(result?.["spaces-sdlc-wiki-finalize-commit"]).toEqual(bindings);
    expect(trustedSdlcToolBindings({
      operation: "wiki",
      execution: { workflowExecutionId: "execution-1", sessionId: "session-1" },
      repository: { id: "repo-1" },
    })?.["spaces-sdlc-mutate-artifact"]).toEqual(bindings);
    expect(trustedSdlcWikiToolBindings({ operation: "interactive" })).toBeUndefined();
    expect(trustedSdlcWikiToolBindings({ operation: "wiki", execution: {} })).toBeUndefined();
  });

  it("binds every direct SDLC tool from trusted Wiki context", () => {
    const result = trustedSdlcToolBindings({
      operation: "wiki",
      workspaceId: "workspace-1",
      actorUserId: "user-1",
      execution: { workflowExecutionId: "execution-1", sessionId: "session-1" },
      repository: { id: "repo-1" },
    });

    expect(Object.keys(result ?? {}).sort()).toEqual([...SDLC_DIRECT_TOOL_NAMES].sort());
    expect(result?.["spaces-sdlc-mutate-artifact"]).toMatchObject(bindings);
    expect(result?.["spaces-sdlc-list-artifacts"]).toMatchObject(bindings);
  });

  it("binds interactive draft PR authority without exposing it to the model", () => {
    const result = trustedSdlcToolBindings({
      operation: "interactive",
      workspaceId: "workspace-1",
      actorUserId: "user-1",
      interactiveGrant: "signed-grant",
      execution: { workflowExecutionId: null, sessionId: null, conversationId: "conversation-1" },
      repository: { id: "repo-1" },
    });

    expect(result?.["spaces-sdlc-create-pull-request"]).toEqual({
      interactiveGrant: "signed-grant",
      conversationId: "conversation-1",
      repoId: "repo-1",
    });
  });
});
