import { describe, it, expect } from "vitest";
import { AWAKENING_SEND_TOOL, withAwakeningSendTool } from "./send-tool.js";

describe("withAwakeningSendTool", () => {
  it("appends the send tool to an existing direct allowlist", () => {
    const out = withAwakeningSendTool({ tools: { direct: ["spaces-search"] } });
    expect((out["tools"] as { direct: string[] }).direct).toEqual([
      "spaces-search",
      AWAKENING_SEND_TOOL,
    ]);
  });

  it("creates tools.direct when the config has no tools block", () => {
    const out = withAwakeningSendTool({ systemPrompt: "x" });
    expect((out["tools"] as { direct: string[] }).direct).toEqual([AWAKENING_SEND_TOOL]);
    expect(out["systemPrompt"]).toBe("x");
  });

  it("is idempotent", () => {
    const once = withAwakeningSendTool({ tools: { direct: [AWAKENING_SEND_TOOL] } });
    const twice = withAwakeningSendTool(once);
    expect((twice["tools"] as { direct: string[] }).direct).toEqual([AWAKENING_SEND_TOOL]);
  });

  it("preserves sibling tool groups and other config keys", () => {
    const out = withAwakeningSendTool({
      modelId: "m",
      tools: { direct: ["a"], subagents: ["spaces"], custom: ["web-search"] },
    });
    const tools = out["tools"] as Record<string, unknown>;
    expect(tools["subagents"]).toEqual(["spaces"]);
    expect(tools["custom"]).toEqual(["web-search"]);
    expect(out["modelId"]).toBe("m");
  });

  it("does not mutate the input config", () => {
    const input = { tools: { direct: ["a"] } };
    withAwakeningSendTool(input);
    expect(input.tools.direct).toEqual(["a"]);
  });

  it("drops non-string entries rather than forwarding them", () => {
    const out = withAwakeningSendTool({ tools: { direct: ["a", 7, null] } });
    expect((out["tools"] as { direct: string[] }).direct).toEqual(["a", AWAKENING_SEND_TOOL]);
  });

  it("tolerates a non-array direct value", () => {
    const out = withAwakeningSendTool({ tools: { direct: "nope" } });
    expect((out["tools"] as { direct: string[] }).direct).toEqual([AWAKENING_SEND_TOOL]);
  });
});
