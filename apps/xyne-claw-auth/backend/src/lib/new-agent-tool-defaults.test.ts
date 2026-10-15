import { describe, it, expect } from "vitest";
import { mergeNewAgentToolDefaults, DEFAULT_NEW_AGENT_TOOL_SOURCES } from "./new-agent-tool-defaults.js";

const SLUGS = ["sandbox-run", "sandbox-repo-setup", "webfetch", "agent-introspect"];

describe("mergeNewAgentToolDefaults", () => {
  it("seeds the default tools and forces the cap on an empty config", () => {
    const out = mergeNewAgentToolDefaults(undefined, SLUGS);
    expect((out["tools"] as Record<string, unknown>)["custom"]).toEqual(SLUGS);
    expect((out["optimizations"] as Record<string, unknown>)["active_tool_cap"]).toBe(true);
  });

  it("unions with a client-sent custom selection without dropping it or duplicating", () => {
    const out = mergeNewAgentToolDefaults({ tools: { custom: ["webfetch", "my-tool"], direct: ["github:create_pr"] } }, SLUGS);
    const tools = out["tools"] as Record<string, unknown>;
    expect(new Set(tools["custom"] as string[])).toEqual(new Set([...SLUGS, "my-tool"]));
    expect(tools["direct"]).toEqual(["github:create_pr"]);
  });

  it("forces the cap on even when the client set it false", () => {
    const out = mergeNewAgentToolDefaults({ optimizations: { active_tool_cap: false, lean_palette: true } }, SLUGS);
    const opt = out["optimizations"] as Record<string, unknown>;
    expect(opt["active_tool_cap"]).toBe(true);
    expect(opt["lean_palette"]).toBe(true);
  });

  it("preserves unrelated config keys", () => {
    const out = mergeNewAgentToolDefaults({ providerOrder: ["claude"], agentAuthoring: true }, SLUGS);
    expect(out["providerOrder"]).toEqual(["claude"]);
    expect(out["agentAuthoring"]).toBe(true);
  });

  it("exposes the sandbox + safe-system sources only", () => {
    expect([...DEFAULT_NEW_AGENT_TOOL_SOURCES]).toEqual(["custom:sandbox", "custom:webfetch", "custom:agent-introspect"]);
  });
});
