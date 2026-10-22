/**
 * The XYNE-66597 fixes wired the way runTask wires them: tools go through
 * capCustomToolOutput into a real pi session (createAgentSession), the repair /
 * error-flag / outcome hooks are installed on that session's agent, and a
 * scripted model drives pi's own loop. Only the model is fake.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Model,
} from "@earendil-works/pi-ai";
import { Type } from "@sinclair/typebox";
import { capCustomToolOutput } from "../src/agent.js";
import { attachRunMessages, pinRunTask } from "../src/run-context.js";
import { installToolCallRepair } from "../src/tool-call-repair.js";
import { installHonestErrorFlag, installToolOutcomeMetric } from "../src/tool-outcome.js";

const model = {
  id: "scripted",
  name: "scripted",
  provider: "test",
  api: "openai-completions",
  baseUrl: "http://localhost",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 4_096,
} as unknown as Model<Api>;

type Call = { name: string; arguments: Record<string, unknown> };

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    timestamp: 0,
  };
}

/** One tool call per model turn, in order, then a final text answer. */
function scripted(turns: Call[]) {
  let i = 0;
  return () => {
    const call = turns[i];
    i += 1;
    const message = call
      ? assistant([{ type: "toolCall", id: `call-${i}`, name: call.name, arguments: call.arguments }], "toolUse")
      : assistant([{ type: "text", text: "done" }], "stop");
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      stream.push({ type: "start", partial: message } as AssistantMessageEvent);
      stream.push({ type: "done", reason: message.stopReason as "stop", message } as AssistantMessageEvent);
      stream.end();
    });
    return stream;
  };
}

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tool-wiring-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A claw run's session: capped tools, repair + error flag + outcome hooks. */
async function runScripted(
  tools: ToolDefinition[],
  turns: Call[],
  opts: { startActive?: string[]; autoLoad?: boolean } = {},
) {
  const authStorage = AuthStorage.inMemory({ test: { type: "api_key", key: "k" } });
  const resourceLoader = new DefaultResourceLoader({ cwd: dir, agentDir: join(dir, ".pi") });
  await resourceLoader.reload();
  const customTools = capCustomToolOutput(tools, dir);
  const { session } = await createAgentSession({
    model,
    cwd: dir,
    authStorage,
    modelRegistry: ModelRegistry.inMemory(authStorage),
    sessionManager: SessionManager.inMemory(dir),
    settingsManager: SettingsManager.inMemory(),
    resourceLoader,
    tools: customTools.map((t) => t.name),
    customTools,
  });
  session.agent.streamFn = scripted(turns) as never;
  const mcpNames = new Set(tools.filter((t) => "mcpToolName" in t).map((t) => t.name));
  const catalog = new Set<string>();
  if (opts.startActive) {
    // A catalog run: only startActive is loaded; load-tools adds the rest
    // through pi's setActiveToolsByName, as runTask's controller does.
    for (const t of customTools) if (!opts.startActive.includes(t.name)) catalog.add(t.name);
    session.setActiveToolsByName(opts.startActive);
  }
  installToolCallRepair(session.agent, {
    catalogNames: () => catalog,
    loadTools: async (names) => {
      session.setActiveToolsByName([...session.agent.state.tools.map((t) => t.name), ...names]);
      return { loaded: names, alreadyLoaded: [] };
    },
    findLoadedTool: (name) => session.agent.state.tools.find((t) => t.name === name),
    autoLoad: () => opts.autoLoad === true,
  });
  installHonestErrorFlag(session.agent, (name) => mcpNames.has(name));
  const outcomes: string[] = [];
  const record = installToolOutcomeMetric(session.agent, () => ({ model: model.id }));
  session.subscribe((event) => {
    if (event.type !== "tool_execution_end") return;
    record(event);
    const text = JSON.stringify(event.result);
    outcomes.push(
      !event.isError ? "ok" : text.includes("not found") ? "not_found" : text.includes("Validation failed") ? "validation" : "error",
    );
  });
  // runTask pins the run and attaches the live transcript the same way.
  await new Promise<void>((resolve, reject) => {
    setImmediate(() => {
      pinRunTask("test task");
      attachRunMessages(() => session.messages as readonly unknown[]);
      session.prompt("go").then(resolve, reject);
    });
  });
  const results = session.messages
    .filter((m) => (m as { role: string }).role === "toolResult")
    .map((m) => {
      const r = m as unknown as { toolName: string; isError: boolean; content: Array<{ text?: string }> };
      return { toolName: r.toolName, isError: r.isError, text: r.content[0]?.text ?? "" };
    });
  return { results, outcomes };
}

/** An MCP tool as mcp.ts builds it: Type.Unsafe schema, mcpToolName set. */
function mcpTool(seen: unknown[]): ToolDefinition {
  return {
    name: "Grafana__query",
    mcpToolName: "query",
    label: "Grafana/query",
    description: "Run a Grafana query.",
    parameters: Type.Unsafe({
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      required: ["query"],
    }),
    execute: async (_id: string, params: unknown) => {
      seen.push(params);
      return { content: [{ type: "text", text: "rows: 3" }], details: {} };
    },
  } as unknown as ToolDefinition;
}

describe("tool-call fixes through capCustomToolOutput and a real pi session", () => {
  it("renames a short tool name, fixes a field's spelling and converts its type", async () => {
    const seen: unknown[] = [];
    const { results, outcomes } = await runScripted([mcpTool(seen)], [{ name: "query", arguments: { Query: "cpu", limit: "5" } }]);
    expect(seen).toEqual([{ query: "cpu", limit: 5 }]);
    expect(results).toEqual([{ toolName: "Grafana__query", isError: false, text: "rows: 3" }]);
    expect(outcomes).toEqual(["ok"]);
  });

  it("answers a missing field with the value used earlier in the conversation", async () => {
    const seen: unknown[] = [];
    const { results, outcomes } = await runScripted(
      [mcpTool(seen)],
      [
        { name: "Grafana__query", arguments: { query: "cpu_usage" } },
        { name: "Grafana__query", arguments: { limit: 10 } },
      ],
    );
    expect(seen).toEqual([{ query: "cpu_usage" }]);
    expect(results[1]?.isError).toBe(true);
    expect(results[1]?.text).toMatch(/^Validation failed for tool "Grafana__query":\n {2}- query: must have required property 'query'/);
    expect(results[1]?.text).toContain('Values used earlier in this conversation for query: "cpu_usage"');
    expect(outcomes).toEqual(["ok", "validation"]);
  });

  it("marks a claw tool's \"Error:\" result as an error, but not an MCP tool's", async () => {
    const sandboxLike = {
      name: "sandbox-read-file",
      label: "Sandbox Read File",
      description: "Read a file.",
      parameters: Type.Unsafe({ type: "object", properties: { path: { type: "string" } }, required: ["path"] }),
      execute: async () => ({ content: [{ type: "text", text: "Error: Session s1 not found." }], details: {} }),
    } as unknown as ToolDefinition;
    const mcpError = {
      ...mcpTool([]),
      execute: async () => ({ content: [{ type: "text", text: "Error: rate limited (upstream data)" }], details: {} }),
    } as unknown as ToolDefinition;
    const { results } = await runScripted(
      [sandboxLike, mcpError],
      [
        { name: "sandbox-read-file", arguments: { path: "/a" } },
        { name: "Grafana__query", arguments: { query: "x" } },
      ],
    );
    expect(results.map((r) => [r.toolName, r.isError])).toEqual([
      ["sandbox-read-file", true],
      ["Grafana__query", false],
    ]);
  });

  it("answers an unknown tool with the closest names", async () => {
    const { results, outcomes } = await runScripted([mcpTool([])], [{ name: "grafana_querry", arguments: {} }]);
    expect(results[0]?.text).toMatch(/^Tool grafana_querry not found\. Closest tools you can call: Grafana__query\./);
    expect(outcomes).toEqual(["not_found"]);
  });

  it("loads a catalog tool on its first call and runs it in the same turn (auto-load on)", async () => {
    const seen: unknown[] = [];
    const other = { ...mcpTool([]), name: "Spaces__search", mcpToolName: "search" } as unknown as ToolDefinition;
    const { results } = await runScripted([other, mcpTool(seen)], [{ name: "Grafana__query", arguments: { query: "cpu" } }], {
      startActive: ["Spaces__search"],
      autoLoad: true,
    });
    expect(seen).toEqual([{ query: "cpu" }]);
    expect(results).toEqual([{ toolName: "Grafana__query", isError: false, text: "rows: 3" }]);
  });

  it("tells the model to load a catalog tool when auto-load is off", async () => {
    const seen: unknown[] = [];
    const other = { ...mcpTool([]), name: "Spaces__search", mcpToolName: "search" } as unknown as ToolDefinition;
    const { results } = await runScripted([other, mcpTool(seen)], [{ name: "Grafana__query", arguments: { query: "cpu" } }], {
      startActive: ["Spaces__search"],
    });
    expect(seen).toEqual([]);
    expect(results[0]?.text).toContain('load-tools({ "names": ["Grafana__query"] })');
  });
});
