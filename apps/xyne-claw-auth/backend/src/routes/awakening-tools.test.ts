import { describe, expect, it } from "vitest";
import { filterMcpServerToolsForAgentConfig, buildAgentToolAllowSet } from "./mcp-agent-tools.js";

/**
 * An awakened run's ONLY way to speak is the bot-identity send tool. It never
 * appears in the agent tool picker (it acts as the bot, so it is deliberately
 * not offered for interactive runs), so a strict `tools.direct` allowlist —
 * which every configured agent has — silently drops it. The agent then reasons
 * correctly, decides to reply, finds no tool, and says nothing.
 * Observed live 2026-08-25 on ask-ai.
 */
const APP_SERVER = {
  serverType: "xyne-spaces-app-tools",
  serverName: "Xyne Spaces App Tools",
  tools: [
    { name: "spaces-search", description: "", inputSchema: {} },
    { name: "spaces-messages", description: "", inputSchema: {} },
    { name: "apps-send-message", description: "", inputSchema: {} },
    { name: "ping", description: "", inputSchema: {} },
  ],
  writeTools: ["apps-send-message"],
} as never;

const noop = () => null;

describe("apps-send-message under a strict agent allowlist", () => {
  it("is DROPPED when the agent's direct list omits it (the live bug)", () => {
    const config = { direct: ["spaces-search", "spaces-messages"] };
    const out = filterMcpServerToolsForAgentConfig(APP_SERVER, config as never, noop as never);
    expect(out?.tools.map((t) => t.name)).toEqual(["spaces-search", "spaces-messages"]);
    expect(out?.tools.some((t) => t.name === "apps-send-message")).toBe(false);
  });

  it("is KEPT once it is injected into the direct list", () => {
    const config = { direct: ["spaces-search", "spaces-messages", "apps-send-message"] };
    const out = filterMcpServerToolsForAgentConfig(APP_SERVER, config as never, noop as never);
    expect(out?.tools.map((t) => t.name)).toContain("apps-send-message");
  });

  it("keeps it listed as a write tool so the HITL/deny layer still sees it", () => {
    const config = { direct: ["apps-send-message"] };
    const out = filterMcpServerToolsForAgentConfig(APP_SERVER, config as never, noop as never);
    expect(out?.writeTools).toContain("apps-send-message");
  });

  it("injecting it does not widen anything else", () => {
    const base = { direct: ["spaces-search"] };
    const withSend = { direct: ["spaces-search", "apps-send-message"] };
    const a = filterMcpServerToolsForAgentConfig(APP_SERVER, base as never, noop as never);
    const b = filterMcpServerToolsForAgentConfig(APP_SERVER, withSend as never, noop as never);
    const added = b!.tools.filter((t) => !a!.tools.some((x) => x.name === t.name)).map((t) => t.name);
    expect(added).toEqual(["apps-send-message"]);
  });

  it("the allow set records it as an exact tool name", () => {
    const allow = buildAgentToolAllowSet({ direct: ["apps-send-message"] } as never);
    expect(allow.toolExact.has("apps-send-message")).toBe(true);
  });
});
