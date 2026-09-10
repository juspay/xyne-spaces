import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spacesFetch: vi.fn(),
  spacesFetchBuffer: vi.fn(),
  spacesFetchText: vi.fn(),
}));

vi.mock("./xyne-spaces-client.js", () => mocks);

async function loadTool(name: string) {
  const mod = await import("./xyne-workflows-tools.js");
  const tool = mod.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} tool not found`);
  return tool;
}

const ctx = { userId: "u1" };

/** Every path spacesFetch was called with, in order. */
function calledPaths(): string[] {
  return mocks.spacesFetch.mock.calls.map((c) => String(c[0]));
}

/** The tool's model-facing text. Tools always emit exactly one text block. */
function textOf(res: { content: Array<{ text: string }> }): string {
  return res.content[0]?.text ?? "";
}

function bodyOf(callIndex: number): unknown {
  const init = mocks.spacesFetch.mock.calls[callIndex]?.[1] as { body?: string } | undefined;
  return init?.body ? JSON.parse(init.body) : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tool surface", () => {
  it("declares the injected run scalars on every tool, so /call can force-inject them", async () => {
    const mod = await import("./xyne-workflows-tools.js");
    expect(mod.tools.length).toBeGreaterThan(0);
    for (const tool of mod.tools) {
      const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      expect(Object.keys(props)).toEqual(
        expect.arrayContaining(["workflowId", "executionId", "focusedStepId"]),
      );
    }
  });

  it("exports every tool name, so the adapter and seed cannot list a stale set", async () => {
    const mod = await import("./xyne-workflows-tools.js");
    // The seed spreads WORKFLOW_TOOL_NAMES into ask-ai's `direct` allowlist, which is
    // strict: a name missing there is dropped with no error and the tool simply never
    // reaches the agent. Deriving it is what makes that impossible.
    expect(mod.WORKFLOW_TOOL_NAMES).toEqual(mod.tools.map((t) => t.name));
    expect(mod.WORKFLOW_TOOL_NAMES).toHaveLength(mod.tools.length);
  });

  it("gates exactly the tools that mutate or execute", async () => {
    const mod = await import("./xyne-workflows-tools.js");
    // Reads must NOT be gated — an approval card on every lookup would train users to
    // click through them, which is how a real write slips past.
    expect([...mod.WORKFLOW_WRITE_TOOL_NAMES].sort()).toEqual(
      ["workflow_create", "workflow_run", "workflow_update"],
    );
    for (const name of mod.WORKFLOW_WRITE_TOOL_NAMES) {
      expect(mod.WORKFLOW_TOOL_NAMES).toContain(name);
    }
  });

  it("uses names that cannot be confused with the legacy spaces-workflow-* tools", async () => {
    const mod = await import("./xyne-workflows-tools.js");
    for (const tool of mod.tools) {
      expect(tool.name).toMatch(/^workflow_/);
    }
  });
});

describe("workflow_catalog", () => {
  it("returns the cheap index when called with no arguments", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ steps: [{ type: "CODE" }] });
    mocks.spacesFetch.mockResolvedValueOnce({ triggers: [{ type: "CRON" }] });
    mocks.spacesFetch.mockResolvedValueOnce({ operators: [] });

    const tool = await loadTool("workflow_catalog");
    const res = await tool.handler({}, ctx);

    expect(calledPaths()).toEqual([
      "/api/workflows-v2/claw/schema/steps",
      "/api/workflows-v2/claw/schema/triggers",
      "/api/workflows-v2/claw/schema/operators",
    ]);
    expect(res.isError).toBeUndefined();
    expect(textOf(res)).toContain("CODE");
  });

  it("expands only the requested types, batching them into one call", async () => {
    mocks.spacesFetch.mockResolvedValue({ type: "X", configSchema: {} });

    const tool = await loadTool("workflow_catalog");
    await tool.handler({ stepTypes: ["HTTP_REQUEST", "CODE"], triggerTypes: ["CRON"] }, ctx);

    expect(calledPaths()).toEqual([
      "/api/workflows-v2/claw/schema/steps/HTTP_REQUEST",
      "/api/workflows-v2/claw/schema/steps/CODE",
      "/api/workflows-v2/claw/schema/triggers/CRON",
    ]);
  });
});

describe("workflow_create", () => {
  const config = { trigger: { type: "CRON" }, steps: [] };

  it("refuses to save an invalid config and hands the issues back for repair", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ valid: false, issues: [{ message: "no trigger" }] });

    const tool = await loadTool("workflow_create");
    const res = await tool.handler({ name: "W", config, folderId: "f1" }, ctx);

    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("no trigger");
    // Validate only — nothing was created.
    expect(calledPaths()).toEqual(["/api/workflows-v2/claw/workflows/validate"]);
  });

  it("switches the new workflow off, so an agent-authored CRON cannot fire unreviewed", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ valid: true, issues: [] });
    mocks.spacesFetch.mockResolvedValueOnce({ id: "wf-1" });
    mocks.spacesFetch.mockResolvedValueOnce({ deactivated: true });

    const tool = await loadTool("workflow_create");
    const res = await tool.handler({ name: "W", config, folderId: "f1" }, ctx);

    expect(calledPaths()).toEqual([
      "/api/workflows-v2/claw/workflows/validate",
      "/api/workflows-v2/claw/workflows",
      "/api/workflows-v2/claw/workflows/wf-1/deactivate",
    ]);
    expect(bodyOf(1)).toMatchObject({ name: "W", folderId: "f1" });
    expect(res.isError).toBeUndefined();
    expect(textOf(res)).toContain('"live": false');
  });

  it("reports a failed deactivate as live rather than as a failed create", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ valid: true, issues: [] });
    mocks.spacesFetch.mockResolvedValueOnce({ id: "wf-2" });
    mocks.spacesFetch.mockRejectedValueOnce(new Error("boom"));

    const tool = await loadTool("workflow_create");
    const res = await tool.handler({ name: "W", config, folderId: "f1" }, ctx);

    expect(res.isError).toBe(true);
    // The model must not retry — a second create would leave two live workflows.
    expect(textOf(res)).toContain("wf-2");
    expect(textOf(res)).toContain("LIVE");
    expect(textOf(res)).toContain("Do not create it again");
  });
});

describe("run scalars", () => {
  it("scopes workflow_get to the injected workflowId", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ id: "wf-9", config: '{"steps":[]}' });

    const tool = await loadTool("workflow_get");
    await tool.handler({ workflowId: "wf-9" }, ctx);

    expect(calledPaths()).toEqual(["/api/workflows-v2/claw/workflows/wf-9"]);
  });

  it("tells the agent what to do instead of guessing when nothing is in scope", async () => {
    const tool = await loadTool("workflow_get");
    const res = await tool.handler({}, ctx);

    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("workflow_list");
    expect(mocks.spacesFetch).not.toHaveBeenCalled();
  });

  it("reads the run in scope for workflow_run_get", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ status: "EXTERNAL_WAIT" });

    const tool = await loadTool("workflow_run_get");
    await tool.handler({ executionId: "ex-1" }, ctx);

    expect(calledPaths()).toEqual(["/api/workflows-v2/claw/executions/ex-1"]);
  });

  it("falls back to the focused step for workflow_step_events", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ events: [] });

    const tool = await loadTool("workflow_step_events");
    await tool.handler({ executionId: "ex-1", focusedStepId: "fetch_data" }, ctx);

    expect(calledPaths()).toEqual([
      "/api/workflows-v2/claw/executions/ex-1/steps/fetch_data/events",
    ]);
  });
});

describe("workflow_node_context", () => {
  it("evaluates an unsaved draft config without touching the saved workflow", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ context: {} });

    const tool = await loadTool("workflow_node_context");
    const draft = { trigger: { type: "MANUAL" }, steps: [{ id: "a" }] };
    await tool.handler({ config: draft, atStepId: "a", workflowId: "wf-1" }, ctx);

    expect(calledPaths()).toEqual(["/api/workflows-v2/claw/schema/available-context"]);
    expect(bodyOf(0)).toEqual({ config: draft, atStepId: "a" });
  });

  it("falls back to the saved config of the workflow in scope", async () => {
    mocks.spacesFetch.mockResolvedValueOnce({ config: '{"trigger":{"type":"MANUAL"},"steps":[]}' });
    mocks.spacesFetch.mockResolvedValueOnce({ context: {} });

    const tool = await loadTool("workflow_node_context");
    await tool.handler({ atStepId: "a", workflowId: "wf-1" }, ctx);

    expect(calledPaths()).toEqual([
      "/api/workflows-v2/claw/workflows/wf-1",
      "/api/workflows-v2/claw/schema/available-context",
    ]);
    expect(bodyOf(1)).toMatchObject({ atStepId: "a" });
  });
});
