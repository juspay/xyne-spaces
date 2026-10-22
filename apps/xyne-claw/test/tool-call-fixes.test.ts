import { afterEach, describe, expect, it, vi } from "vitest";

// Spills upload to GCS in the background; keep tests off the network.
vi.mock("../src/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/storage.js")>()),
  gcsUploadSessionFile: async () => false,
}));
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLocalHarnessToolCallRequest } from "xyne-claw-shared";
import { getCustomTool, type ToolDefinition } from "xyne-claw-shared/tools";
import { createScopedToolMap, redirectSpillPath } from "../src/scoped-tools.js";
import { modelRelativeInlineCap, TOOL_RESULT_INLINE_CAP_BYTES } from "../src/tool-output.js";

describe("spilled tool-result paths (wrong-path errors)", () => {
  let base: string;
  afterEach(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  function setup() {
    base = mkdtempSync(join(tmpdir(), "spill-"));
    const workspace = join(base, "workspaces", "conv_agent");
    const context = join(base, "sessions", "conv_agent", ".context");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(context, "tool-results"), { recursive: true });
    writeFileSync(join(context, "tool-results", "grafana-query.json"), '{"rows":1}\n');
    return { workspace, context };
  }

  it("finds a spilled file under the session .context when the model builds the path from its working dir", () => {
    const { workspace, context } = setup();
    const want = join(context, "tool-results", "grafana-query.json");
    expect(redirectSpillPath(workspace, [context], "tool-results/grafana-query.json")).toBe(want);
    expect(redirectSpillPath(workspace, [context], ".context/tool-results/grafana-query.json")).toBe(want);
    expect(redirectSpillPath(workspace, [context], join(workspace, ".context", "tool-results", "grafana-query.json"))).toBe(want);
    expect(redirectSpillPath(workspace, [context], ".context/tool-results")).toBe(join(context, "tool-results"));
  });

  it("leaves other paths alone", () => {
    const { workspace, context } = setup();
    writeFileSync(join(workspace, "notes.txt"), "x");
    expect(redirectSpillPath(workspace, [context], "notes.txt")).toBeUndefined();
    expect(redirectSpillPath(workspace, [context], "tool-results/missing.json")).toBeUndefined();
    expect(redirectSpillPath(workspace, [], "tool-results/grafana-query.json")).toBeUndefined();
  });

  it("read follows the redirect, and a path that is still missing gets the working dir and results dir", async () => {
    const { workspace, context } = setup();
    const tools = createScopedToolMap(workspace, [context]);
    const ok = await tools.read!.execute("1", { path: "tool-results/grafana-query.json" });
    expect(JSON.stringify(ok.content)).toContain('{\\"rows\\":1}');
    await expect(tools.ls!.execute("2", { path: "nope" })).rejects.toThrow(
      new RegExp(`Path not found[\\s\\S]*working directory ${workspace}[\\s\\S]*${join(context, "tool-results")}`),
    );
  });
});

describe("modelRelativeInlineCap", () => {
  it("is a tenth of the window, never above the fleet cap", () => {
    expect(modelRelativeInlineCap(128_000)).toBe(51_200);
    expect(modelRelativeInlineCap(200_000)).toBe(80_000);
    expect(modelRelativeInlineCap(1_000_000)).toBe(TOOL_RESULT_INLINE_CAP_BYTES);
    expect(modelRelativeInlineCap(8_000)).toBe(16 * 1024);
    expect(modelRelativeInlineCap(undefined)).toBe(TOOL_RESULT_INLINE_CAP_BYTES);
  });
});

describe("desktop gateway tool calls", () => {
  it("accepts the gateway server type claw-auth lists to the desktop", () => {
    expect(isLocalHarnessToolCallRequest({ serverType: "gateway:Grafana%20Cloud:prod-1", toolName: "query", params: {} })).toBe(true);
    expect(isLocalHarnessToolCallRequest({ serverType: "spaces", toolName: "search", params: {} })).toBe(true);
  });

  it("still rejects malformed names", () => {
    expect(isLocalHarnessToolCallRequest({ serverType: "gateway:a:b:c", toolName: "q" })).toBe(false);
    expect(isLocalHarnessToolCallRequest({ serverType: "gateway:a/b:c", toolName: "q" })).toBe(false);
    expect(isLocalHarnessToolCallRequest({ serverType: "../etc", toolName: "q" })).toBe(false);
    expect(isLocalHarnessToolCallRequest({ serverType: "gateway:a:b", toolName: "a:b" })).toBe(false);
  });
});

describe("sandbox tools default sessionId to the conversation's sandbox", () => {
  const tool = (slug: string): ToolDefinition => {
    const found = getCustomTool(slug);
    if (!found) throw new Error(`no tool ${slug}`);
    return found;
  };
  const required = (t: ToolDefinition) => (t.inputSchema as Record<string, unknown>)["required"] as string[];
  const sandboxReadFile = tool("sandbox-read-file");

  it("no longer require sessionId on follow-up tools", () => {
    const slugs = ["sandbox-run-detached", "sandbox-poll-job", "sandbox-write-file", "sandbox-edit-file", "sandbox-copy-in", "sandbox-read-file", "sandbox-deliver-files"];
    for (const slug of slugs) expect(required(tool(slug)), slug).not.toContain("sessionId");
  });

  it("still requires an explicit sessionId to destroy", () => {
    expect(required(tool("sandbox-destroy"))).toContain("sessionId");
  });

  it("answers clearly when the conversation has no sandbox", async () => {
    const result = await sandboxReadFile.execute({ path: "/workspace/a.txt" }, { config: {}, meta: { userId: "u", conversationId: "c-none", agentSlug: "a" } } as never);
    expect(result).toMatch(/^Error: No sandbox session for this conversation/);
  });
});

describe("switches", () => {
  /** pinRun* use AsyncLocalStorage.enterWith; run each case in its own async scope. */
  const inRun = <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => setImmediate(() => fn().then(resolve, reject)));

  it("tool_result_cap_by_model: a run's pinned cap spills a result the fleet cap would keep inline", async () => {
    const { pinRunInlineCap, pinRunTask } = await import("../src/run-context.js");
    const { promoteIfOversized } = await import("../src/tool-output.js");
    const dir = mkdtempSync(join(tmpdir(), "cap-"));
    try {
      const text = "x".repeat(60_000);
      const fleet = await inRun(async () => {
        pinRunTask("t");
        return promoteIfOversized(dir, "custom", "big", text);
      });
      expect(fleet).toBe(text);
      const sized = await inRun(async () => {
        pinRunTask("t");
        pinRunInlineCap(modelRelativeInlineCap(128_000));
        return promoteIfOversized(dir, "custom", "big", text);
      });
      expect(sized).toMatch(/^\[Tool returned 60000 chars — full result saved to /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tool_call_examples: adds example arguments only to tools with nested required fields, only when on", async () => {
    const { capCustomToolOutput } = await import("../src/agent.js");
    const { pinRunOptimizations } = await import("../src/optimizations.js");
    const { Type } = await import("@sinclair/typebox");
    const nested = {
      name: "ask-user-question",
      label: "q",
      description: "Ask.",
      parameters: Type.Unsafe({
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" } }, required: ["id", "label"] },
          },
        },
        required: ["questions"],
      }),
      execute: async () => ({ content: [], details: {} }),
    };
    const flat = { ...nested, name: "flat", parameters: Type.Unsafe({ type: "object", properties: { q: { type: "string" } }, required: ["q"] }) };
    const describe = (on: boolean) =>
      inRun(async () => {
        if (on) pinRunOptimizations("+tool_call_examples");
        return capCustomToolOutput([nested, flat] as never, tmpdir()).map((t) => t.description);
      });
    expect(await describe(false)).toEqual(["Ask.", "Ask."]);
    expect(await describe(true)).toEqual(['Ask.\n\nExample arguments: {"questions":[{"id":"<id>","label":"<label>"}]}', "Ask."]);
  });
});
