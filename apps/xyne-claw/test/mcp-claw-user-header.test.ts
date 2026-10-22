import { describe, it, expect, vi, afterEach } from "vitest";
import { CLAW_USER_HEADER, loadMcpToolsForUser, searchDeploymentTools } from "../src/mcp.js";

const LISTING = [
  {
    serverType: "github",
    serverName: "GitHub",
    writeTools: [],
    tools: [{ name: "search_repositories", description: "Search repos", inputSchema: {}, readOnly: true }],
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubClawAuth(): Array<{ url: string; headers: Record<string, string> }> {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      const data = url.includes("/mcp/tools/search")
        ? { mode: "search", matches: [] }
        : url.endsWith("/mcp/tools")
          ? LISTING
          : { content: "ok" };
      return new Response(JSON.stringify({ success: true, data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return seen;
}

describe("x-claw-user header on claw-auth MCP calls", () => {
  it("carries the run's user on the tool listing and on tool calls", async () => {
    const seen = stubClawAuth();
    const { groups } = await loadMcpToolsForUser(
      "session-1", "token-1", "/tmp", undefined, undefined, "/tmp",
      undefined, undefined, undefined, undefined, "user-42",
    );
    const tool = groups[0]!.tools[0]! as unknown as { execute: (id: string, params: Record<string, unknown>) => Promise<unknown> };
    await tool.execute("call-1", { query: "x" });
    await searchDeploymentTools("session-1", "token-1", { query: "x", limit: 5 }, "user-42");
    expect(seen.map((r) => r.url.replace(/^.*\/claw\/api\/v1\/sessions\/session-1/, ""))).toEqual([
      "/mcp/tools",
      "/mcp/call",
      "/mcp/tools/search?q=x&limit=5",
    ]);
    for (const request of seen) expect(request.headers[CLAW_USER_HEADER]).toBe("user-42");
  });

  it("sends no user header when the run has no user", async () => {
    const seen = stubClawAuth();
    await loadMcpToolsForUser("session-1", "token-1", "/tmp");
    expect(seen[0]!.headers[CLAW_USER_HEADER]).toBeUndefined();
  });
});
