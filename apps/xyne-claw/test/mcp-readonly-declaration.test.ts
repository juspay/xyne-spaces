import { describe, it, expect, vi, afterEach } from "vitest";
import { openPaletteAdmits, classifyToolRisk } from "xyne-claw-shared";
import { loadMcpToolsForUser } from "../src/mcp.js";

/**
 * A read-only MCP tool must survive a read-only open palette.
 *
 * Without a `readOnly` declaration from claw-auth, `admittedByOpenPalette`
 * (routes/run.ts) passes `isWriteTool: undefined` and `classifyToolRisk`
 * guesses from the name — a guess that leans write and reads "star" as a
 * mutation. That silently kept github-list-stargazers, github-star-history
 * and github-stargazer-profiles out of every run whose palette was open at
 * "read": the UI listed them, load-tools never did.
 */

const LISTING = [
  {
    serverType: "github",
    serverName: "GitHub",
    writeTools: ["create_repository", "merge_pull_request"],
    tools: [
      { name: "github-list-stargazers", description: "List stargazers", inputSchema: {}, readOnly: true },
      { name: "github-star-history", description: "Star growth", inputSchema: {}, readOnly: true },
      { name: "create_issue", description: "Open an issue", inputSchema: {} },
      { name: "search_repositories", description: "Search repos", inputSchema: {} },
    ],
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

async function loadGithubTools() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: LISTING }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  const { groups } = await loadMcpToolsForUser("session-1", "token-1", "/tmp");
  const github = groups.find((g) => g.serverType === "github");
  expect(github).toBeDefined();
  return new Map(
    github!.tools.map((t) => [t.name.replace(/^GitHub__/, ""), t as { name: string; isWriteTool?: boolean }]),
  );
}

describe("readOnly declaration → isWriteTool:false", () => {
  it("marks declared read-only tools, and leaves everything else alone", async () => {
    const tools = await loadGithubTools();
    expect(tools.get("github-list-stargazers")?.isWriteTool).toBe(false);
    expect(tools.get("github-star-history")?.isWriteTool).toBe(false);
    // No declaration → still undefined, so the name heuristic keeps its say.
    expect(tools.get("create_issue")?.isWriteTool).toBeUndefined();
    expect(tools.get("search_repositories")?.isWriteTool).toBeUndefined();
  });

  it("lets a read-only palette admit the star tools without widening it to writes", async () => {
    const tools = await loadGithubTools();
    const admits = (name: string): boolean =>
      openPaletteAdmits("read", name, tools.get(name)?.isWriteTool);

    // The whole point: "star" in the name no longer reads as a mutation.
    expect(classifyToolRisk("github-list-stargazers")).toBe("write");
    expect(admits("github-list-stargazers")).toBe(true);
    expect(admits("github-star-history")).toBe(true);

    // And the fix must NOT have widened the palette to real writes — this is
    // why the connector's writeTools list can't be used as the source of
    // record here (create_issue is absent from it yet plainly mutates).
    expect(admits("create_issue")).toBe(false);
  });
});
