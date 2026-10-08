import { describe, expect, it, vi } from "vitest";

// The workflow scope section is pure — no Spaces call — so the client is stubbed only to
// keep the module import side-effect free.
vi.mock("../mcp/servers/xyne-spaces-client.js", () => ({
  interact: vi.fn(),
  spacesFetch: vi.fn(),
  spacesFetchText: vi.fn(),
  spacesFetchBuffer: vi.fn(),
}));

const { buildAttachedContextPayload } = await import("./agentChatContextService.js");

/** The prompt block the agent actually reads. */
async function promptFor(opts: Parameters<typeof buildAttachedContextPayload>[2]): Promise<string> {
  const res = await buildAttachedContextPayload([], undefined, opts);
  return res.promptPrefix ?? "";
}

describe("workflow scope in the attached-context block", () => {
  it("says nothing when no workflow is in scope", async () => {
    const res = await buildAttachedContextPayload([], undefined, {});
    expect(res.promptPrefix ?? "").toBe("");
    expect(res.contextFiles).toEqual([]);
  });

  it("names the workflow the builder has open", async () => {
    const prompt = await promptFor({ workflowId: "wf-1" });
    expect(prompt).toContain("# Attached context");
    expect(prompt).toContain("Workflow (id=wf-1)");
  });

  it("tells the agent the tools are already scoped, so it stops listing to find it", async () => {
    // The defect this fixes: with only a run scalar and no prose, the agent opened by
    // calling workflow_list and describing "one workflow — Test" instead of answering
    // about the one on screen.
    const prompt = await promptFor({ workflowId: "wf-1" });
    expect(prompt).toContain("workflow_get");
    expect(prompt).toContain("Do not call `workflow_list`");
  });

  it("describes a run rather than a definition when an execution is in scope", async () => {
    const prompt = await promptFor({ workflowExecutionId: "ex-9" });
    expect(prompt).toContain("Workflow run (executionId=ex-9)");
    expect(prompt).toContain("workflow_run_get");
    expect(prompt).toContain("workflow_step_events");
    expect(prompt).not.toContain("workflow_get with no id to read its current definition");
  });

  it("prefers the run when both ids ride along, since that is the narrower subject", async () => {
    const prompt = await promptFor({ workflowId: "wf-1", workflowExecutionId: "ex-9" });
    expect(prompt).toContain("Workflow run (executionId=ex-9)");
    expect(prompt).not.toContain("Workflow (id=wf-1)");
  });

  it("puts the workflow first — it is the subject, not a footnote", async () => {
    const prompt = await promptFor({ workflowId: "wf-1" });
    const headingIndex = prompt.indexOf("## Workflow (id=wf-1)");
    expect(headingIndex).toBeGreaterThan(-1);
    // Nothing but the block preamble precedes it.
    expect(prompt.slice(0, headingIndex)).not.toContain("##");
  });
});
