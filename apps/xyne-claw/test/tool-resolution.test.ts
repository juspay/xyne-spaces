/**
 * tool-resolution.test.ts — the single-derivation contract:
 *  - alias and def-less servers are first-class (the github-mcp-npx incident);
 *  - authorization matches the historical run.ts filter semantics (5-way
 *    direct match, subagent grants, custom/gateway picks, no-config = all);
 *  - every exclusion carries a reason; failed servers stay visible;
 *  - PARITY: fast presentation (direct ∪ catalog) ≡ allowed set.
 */
import { describe, it, expect } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { resolveTools, presentAsFastCatalog, matchesDirectPick } from "../src/tool-resolution.js";
import type { McpToolGroup } from "../src/mcp.js";

function tool(name: string, extra?: Record<string, unknown>): ToolDefinition {
  return { name, description: `${name} d`, parameters: { type: "object", properties: {} }, ...extra } as unknown as ToolDefinition;
}
function group(serverType: string, tools: ToolDefinition[], writeTools: string[] = []): McpToolGroup {
  return { serverType, serverName: serverType, tools, writeTools };
}

const bitbucket = group("bitbucket", [tool("Bitbucket__get_pull_request"), tool("Bitbucket__create_pull_request")], ["create_pull_request"]);
const githubNpx = group("github-mcp-npx", [tool("GitHub__search_code"), tool("GitHub__merge_pull_request")], ["merge_pull_request"]);
const defLess = group("research-agent-mcp", [tool("Research__lookup")]);
const gatewayGroup = group("gateway-svc", [tool("Mettle__query", { serviceName: "mettle" })]);

describe("resolveTools", () => {
  it("no toolsConfig → everything allowed (backwards compatible)", () => {
    const r = resolveTools({ groups: [bitbucket, githubNpx, defLess] });
    expect(r.allowed.length).toBe(5);
    expect(r.tools.every((t) => t.verdict.allowed)).toBe(true);
  });

  it("alias server resolves to canonical wrapper and its allowlist identity", () => {
    const r = resolveTools({ groups: [githubNpx], toolsConfig: { subagents: ["github"] } });
    expect(r.allowed.map((t) => t.tool.name).sort()).toEqual(["GitHub__merge_pull_request", "GitHub__search_code"]);
    expect(r.allowed[0]?.source).toBe("subagent:github");
  });

  it("def-less server grants by serverType in tools.subagents", () => {
    const r = resolveTools({ groups: [defLess], toolsConfig: { subagents: ["research-agent-mcp"] } });
    expect(r.allowed.map((t) => t.tool.name)).toEqual(["Research__lookup"]);
    expect(r.allowed[0]?.source).toBe("server:research-agent-mcp");
  });

  it("ungranted servers are denied WITH a reason (never silently absent)", () => {
    const r = resolveTools({ groups: [githubNpx], toolsConfig: { subagents: ["bitbucket"] } });
    expect(r.allowed).toEqual([]);
    expect(r.tools[0]?.verdict.allowed).toBe(false);
    expect(r.tools[0]?.verdict.reason).toContain("github");
    expect(r.missingServerHints().join(" ")).toContain("github-mcp-npx");
  });

  it("individual direct pick admits a tool without its wrapper grant", () => {
    const r = resolveTools({ groups: [bitbucket], toolsConfig: { subagents: [], direct: ["Bitbucket__get_pull_request"] } });
    expect(r.allowed.map((t) => t.tool.name)).toEqual(["Bitbucket__get_pull_request"]);
  });

  it("gateway serviceName grant admits gateway tools", () => {
    const r = resolveTools({ groups: [gatewayGroup], toolsConfig: { subagents: [], gateway: ["mettle"] } });
    expect(r.allowed.map((t) => t.tool.name)).toEqual(["Mettle__query"]);
  });

  it("failed servers stay visible in servers[], report(), and hints", () => {
    const r = resolveTools({
      groups: [bitbucket],
      failedGroups: [{ serverType: "github-mcp-npx", serverName: "GitHub", error: "spawn timeout" }],
      toolsConfig: { subagents: ["bitbucket"] },
    });
    expect(r.servers.some((s) => s.error === "spawn timeout")).toBe(true);
    expect(r.report()).toContain("FAILED to list (spawn timeout)");
    expect(r.missingServerHints().join(" ")).toContain("spawn timeout");
  });

  it("write classification uses the runtime tool name (suffix after __)", () => {
    const r = resolveTools({ groups: [bitbucket, githubNpx] });
    const writes = r.tools.filter((t) => t.isWrite).map((t) => t.tool.name).sort();
    expect(writes).toEqual(["Bitbucket__create_pull_request", "GitHub__merge_pull_request"]);
  });
});

describe("matchesDirectPick — the five historical conventions", () => {
  it("bare, suffix, prefixed-config, normalized, selectionKey", () => {
    expect(matchesDirectPick(tool("user-send-message"), ["user-send-message"])).toBe(true);
    expect(matchesDirectPick(tool("Xyne__user-send-message"), ["user-send-message"])).toBe(true);
    expect(matchesDirectPick(tool("apps-send-message"), ["xyne-spaces-app-tools__apps-send-message"])).toBe(true);
    expect(matchesDirectPick(tool("Xyne_Spaces_App_Tools__apps-send-message"), ["xyne-spaces-app-tools__apps-send-message"])).toBe(true);
    expect(matchesDirectPick(tool("anything", { selectionKey: "custom:webfetch" }), ["custom:webfetch"])).toBe(true);
    expect(matchesDirectPick(tool("unrelated"), ["other-tool"])).toBe(false);
  });
});

describe("presentAsFastCatalog — parity invariant", () => {
  it("direct ∪ catalog ≡ allowed, split exactly by isWrite", () => {
    const r = resolveTools({
      groups: [bitbucket, githubNpx, defLess],
      toolsConfig: { subagents: ["bitbucket", "github", "research-agent-mcp"] },
    });
    const { directTools, catalogTools } = presentAsFastCatalog(r);
    const union = [...directTools, ...catalogTools].map((t) => t.tool.name).sort();
    expect(union).toEqual(r.allowed.map((t) => t.tool.name).sort());
    expect(directTools.every((t) => t.isWrite)).toBe(true);
    expect(catalogTools.every((t) => !t.isWrite)).toBe(true);
    // the incident case: github-mcp-npx read tool present in the fast catalog
    expect(catalogTools.map((t) => t.tool.name)).toContain("GitHub__search_code");
  });
});
