import { describe, it, expect } from "vitest";
import { buildCapabilityGapTool, draftTestModelSettings, isDraftTestRun } from "../src/draft-capability-gap.js";

type ToolResult = { content: Array<{ text: string }>; details: Record<string, unknown> };

async function call(
  tool: ReturnType<typeof buildCapabilityGapTool>,
  params: unknown,
): Promise<ToolResult> {
  return (await tool.execute("call-1", params)) as ToolResult;
}

describe("report_capability_gap", () => {
  it("echoes a valid gap in details for the dashboard", async () => {
    const tool = buildCapabilityGapTool();
    const res = await call(tool, { capability: " Linear ", status: "not_added", need: "list your open issues" });
    expect(res.details).toEqual({ capability: "Linear", status: "not_added", need: "list your open issues" });
  });

  it("rejects an unknown status or missing fields", async () => {
    const tool = buildCapabilityGapTool();
    expect((await call(tool, { capability: "Linear", status: "maybe", need: "x" })).details["error"]).toBe(true);
    expect((await call(tool, { capability: "", status: "not_added", need: "x" })).details["error"]).toBe(true);
    expect((await call(tool, { capability: "Linear", status: "not_added" })).details["error"]).toBe(true);
  });

  it("reports each capability and status once per run", async () => {
    const tool = buildCapabilityGapTool();
    await call(tool, { capability: "Slack", status: "test_blocked", need: "post the summary" });
    const again = await call(tool, { capability: "slack", status: "test_blocked", need: "post it" });
    expect(again.details["duplicate"]).toBe(true);
    const other = await call(tool, { capability: "Slack", status: "not_connected", need: "read #eng" });
    expect(other.details["status"]).toBe("not_connected");
  });
});

describe("isDraftTestRun", () => {
  it("is set only by the explicit flag", () => {
    expect(isDraftTestRun({ draftTestRun: true })).toBe(true);
    expect(isDraftTestRun({ draftTestRun: "true" })).toBe(false);
    expect(isDraftTestRun(undefined)).toBe(false);
  });
});

describe("draftTestModelSettings", () => {
  const grid = { url: "https://grid", suggestUrl: "https://grid", suggestModel: "open-fast", fastModel: "kimi-latest" };

  it("runs on the Build chat's model with thinking off", () => {
    expect(draftTestModelSettings(undefined, grid)).toEqual({ model: "open-fast", thinkingLevel: "off" });
  });

  it("uses the fast model when the suggest model is on another endpoint", () => {
    const local = { ...grid, suggestUrl: "http://localhost:4000" };
    expect(draftTestModelSettings(undefined, local).model).toBe("kimi-latest");
  });

  it("keeps settings the draft sets itself", () => {
    expect(draftTestModelSettings({ model: "glm-5", thinkingLevel: "low" }, grid)).toEqual({
      model: "glm-5",
      thinkingLevel: "low",
    });
  });
});
