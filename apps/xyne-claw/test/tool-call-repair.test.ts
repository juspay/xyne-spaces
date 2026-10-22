import { describe, expect, it } from "vitest";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Model,
} from "@earendil-works/pi-ai";
import { Type } from "@sinclair/typebox";
import { installToolCallRepair, notFoundMessage, resolveToolName } from "../src/tool-call-repair.js";

const set = (...names: string[]) => new Set(names);

describe("resolveToolName", () => {
  // Names from sampled "Tool X not found" errors (XYNE-66597 data pull).
  const active = set(
    "Xyne_Spaces_App_Tools__spaces-messages",
    "Xyne_Spaces_App_Tools__spaces-emails",
    "Juspay_Alerts_MCP_1_2__update_alert_metadata_juspay",
    "search-tools",
  );

  it("leaves a loaded tool alone", () => {
    expect(resolveToolName("search-tools", active, set())).toEqual({ kind: "active" });
  });

  it("renames a short name to the one tool with that name", () => {
    expect(resolveToolName("spaces-messages", active, set())).toEqual({
      kind: "renamed",
      name: "Xyne_Spaces_App_Tools__spaces-messages",
      inCatalog: false,
    });
  });

  it("renames a wrong server prefix", () => {
    expect(resolveToolName("Xyne_Spaces__spaces-emails", active, set())).toMatchObject({
      kind: "renamed",
      name: "Xyne_Spaces_App_Tools__spaces-emails",
    });
    expect(resolveToolName("Juspay_Internal_Alerts_MCP_1_2__update_alert_metadata_juspay", active, set())).toMatchObject({
      kind: "renamed",
      name: "Juspay_Alerts_MCP_1_2__update_alert_metadata_juspay",
    });
  });

  it("renames across case and separator drift", () => {
    expect(resolveToolName("Spaces_Messages", active, set())).toMatchObject({
      kind: "renamed",
      name: "Xyne_Spaces_App_Tools__spaces-messages",
    });
  });

  it("picks the most specific tool when a single-underscore prefix also ends with a shorter tool's name", () => {
    // Seen in a local run: `Notion_notion-search` also ends with a bare `search`.
    expect(resolveToolName("Notion_notion-search", set("search-tools"), set("Notion__notion-search", "Spaces__search"))).toEqual({
      kind: "renamed",
      name: "Notion__notion-search",
      inCatalog: true,
    });
  });

  it("does not guess between two tools with the same name", () => {
    const two = set("A__list-items", "B__list-items");
    const result = resolveToolName("list-items", two, set());
    expect(result.kind).toBe("unknown");
    expect(result.kind === "unknown" && result.closest).toEqual(expect.arrayContaining(["A__list-items", "B__list-items"]));
  });

  it("prefers the loaded one when a catalog tool shares the name", () => {
    expect(resolveToolName("list-items", set("A__list-items"), set("B__list-items"))).toEqual({
      kind: "renamed",
      name: "A__list-items",
      inCatalog: false,
    });
  });

  it("points at the catalog for a tool that is not loaded", () => {
    expect(resolveToolName("Grafana__query", set(), set("Grafana__query"))).toEqual({ kind: "catalog", name: "Grafana__query" });
    expect(resolveToolName("query", set(), set("Grafana__query"))).toEqual({ kind: "renamed", name: "Grafana__query", inCatalog: true });
  });

  it("finds nothing for an unrelated name", () => {
    expect(resolveToolName("web-search", active, set())).toMatchObject({ kind: "unknown" });
  });
});

describe("notFoundMessage", () => {
  it("keeps pi's wording first so claw-auth still counts a palette miss", () => {
    const text = notFoundMessage("web-search", { kind: "unknown", closest: [] }, { searchTools: true });
    expect(text).toMatch(/^Tool web-search not found/);
    expect(text).toContain("search-tools");
  });

  it("tells the model to load a catalog tool", () => {
    const text = notFoundMessage("Grafana__query", { kind: "catalog", name: "Grafana__query" }, { searchTools: true });
    expect(text).toContain('load-tools({ "names": ["Grafana__query"] })');
  });

  it("explains that plan tracking is off", () => {
    expect(notFoundMessage("todo-write", { kind: "unknown", closest: [] }, { searchTools: false })).toContain(
      "plan tracking is off",
    );
  });

  it("lists the closest names", () => {
    const text = notFoundMessage("spaces-thread", { kind: "unknown", closest: ["a", "b"] }, { searchTools: false });
    expect(text).toContain("Closest tools you can call: a, b.");
  });
});

// ── Through pi's real agent loop ─────────────────────────────────────────────

const model = { id: "test-model", name: "test-model", provider: "test", api: "openai-completions" } as unknown as Model<Api>;

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

/** First model call asks for `toolName`, the second answers. */
function scriptedStream(toolName: string) {
  let call = 0;
  const seenTools: string[][] = [];
  const streamFn = (_m: Model<Api>, context: { tools?: Array<{ name: string }> }) => {
    call += 1;
    seenTools.push((context.tools ?? []).map((t) => t.name));
    const message =
      call === 1
        ? assistant([{ type: "toolCall", id: "call-1", name: toolName, arguments: { q: "x" } }], "toolUse")
        : assistant([{ type: "text", text: "done" }], "stop");
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      stream.push({ type: "start", partial: message } as AssistantMessageEvent);
      stream.push({ type: "done", reason: message.stopReason as "stop", message } as AssistantMessageEvent);
      stream.end();
    });
    return stream;
  };
  return { streamFn, seenTools };
}

function tool(name: string, ran: string[]): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({ q: Type.String() }),
    execute: async () => {
      ran.push(name);
      return { content: [{ type: "text", text: `${name} ok` }], details: {} };
    },
  } as AgentTool;
}

function toolResults(agent: Agent): Array<{ toolName: string; isError: boolean; text: string }> {
  return agent.state.messages
    .filter((m) => (m as { role: string }).role === "toolResult")
    .map((m) => {
      const r = m as unknown as { toolName: string; isError: boolean; content: Array<{ text?: string }> };
      return { toolName: r.toolName, isError: r.isError, text: r.content[0]?.text ?? "" };
    });
}

describe("installToolCallRepair in pi's agent loop", () => {
  it("runs a call made with the wrong server prefix", async () => {
    const ran: string[] = [];
    const { streamFn } = scriptedStream("Xyne_Spaces__spaces-emails");
    const agent = new Agent({
      initialState: { model, systemPrompt: "", tools: [tool("Xyne_Spaces_App_Tools__spaces-emails", ran)] },
      streamFn: streamFn as never,
    });
    installToolCallRepair(agent as never);
    await agent.prompt("go");
    expect(ran).toEqual(["Xyne_Spaces_App_Tools__spaces-emails"]);
    expect(toolResults(agent)).toEqual([{ toolName: "Xyne_Spaces_App_Tools__spaces-emails", isError: false, text: "Xyne_Spaces_App_Tools__spaces-emails ok" }]);
    // The persisted assistant message carries the name that actually ran.
    const call = (agent.state.messages[1] as AssistantMessage).content[0] as { name: string };
    expect(call.name).toBe("Xyne_Spaces_App_Tools__spaces-emails");
  });

  it("answers an unknown tool with a helpful error and drops the stand-in before the next model call", async () => {
    const ran: string[] = [];
    const { streamFn, seenTools } = scriptedStream("web-search");
    const agent = new Agent({
      initialState: { model, systemPrompt: "", tools: [tool("search-tools", ran), tool("web-fetch", ran)] },
      streamFn: streamFn as never,
    });
    installToolCallRepair(agent as never);
    await agent.prompt("go");
    expect(ran).toEqual([]);
    const [result] = toolResults(agent);
    expect(result?.isError).toBe(true);
    expect(result?.text).toMatch(/^Tool web-search not found\./);
    expect(result?.text).toContain("Use search-tools");
    expect(seenTools[1]).toEqual(["search-tools", "web-fetch"]);
  });

  it("loads a catalog tool on call when auto-load is on", async () => {
    const ran: string[] = [];
    const grafana = tool("Grafana__query", ran);
    const { streamFn, seenTools } = scriptedStream("Grafana__query");
    const agent = new Agent({ initialState: { model, systemPrompt: "", tools: [tool("load-tools", ran)] }, streamFn: streamFn as never });
    const loaded: string[] = [];
    installToolCallRepair(agent as never, {
      catalogNames: () => new Set(["Grafana__query"]),
      loadTools: async (names) => {
        loaded.push(...names);
        agent.state.tools = [...agent.state.tools, grafana];
        return { loaded: names, alreadyLoaded: [] };
      },
      findLoadedTool: (name) => agent.state.tools.find((t) => t.name === name),
      autoLoad: () => true,
    });
    await agent.prompt("go");
    expect(loaded).toEqual(["Grafana__query"]);
    expect(ran).toEqual(["Grafana__query"]);
    expect(toolResults(agent)[0]?.isError).toBe(false);
    expect(seenTools[0]).toEqual(["load-tools"]);
  });

  it("asks for load-tools when auto-load is off", async () => {
    const ran: string[] = [];
    const { streamFn } = scriptedStream("Grafana__query");
    const agent = new Agent({ initialState: { model, systemPrompt: "", tools: [tool("load-tools", ran)] }, streamFn: streamFn as never });
    installToolCallRepair(agent as never, {
      catalogNames: () => new Set(["Grafana__query"]),
      loadTools: async () => ({ loaded: [], alreadyLoaded: [] }),
      findLoadedTool: () => undefined,
      autoLoad: () => false,
    });
    await agent.prompt("go");
    expect(ran).toEqual([]);
    expect(toolResults(agent)[0]?.text).toContain('load-tools({ "names": ["Grafana__query"] })');
  });
});
