import { describe, expect, it, vi } from "vitest";

const rows = [
  { slug: "github__github-list-stargazers", name: "github-list-stargazers", description: "List who starred a repository", source: "mcp:github", inputSchema: {} },
  { slug: "github__list_pull_requests", name: "list_pull_requests", description: "List pull requests in a GitHub repository", source: "mcp:github", inputSchema: {} },
  { slug: "todo-read", name: "Read plan", description: "Read your current plan (todo list)", source: "builtin", inputSchema: {} },
  { slug: "asana__list-tasks", name: "list-tasks", description: "List tasks in a project", source: "mcp:asana", inputSchema: {} },
];

vi.mock("../../db.js", () => ({
  prisma: {
    tool: { findMany: vi.fn(async (args: { where: { slug?: { in: string[] } } }) => (args.where.slug ? rows.filter((r) => args.where.slug!.in.includes(r.slug)) : rows)) },
    agent: { findMany: vi.fn(async () => []) },
    agentTool: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("./bank.js", () => ({
  memoryEnabled: () => true,
  ensureToolIndexBank: vi.fn(async () => {
    throw new TypeError("fetch failed");
  }),
  memory: () => ({}),
}));
vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const { keywordSearchTools, searchToolsWithFallback } = await import("./search.js");

describe("tool search when the memory backend is down", () => {
  it("falls back to keyword ranking instead of throwing", async () => {
    const out = await searchToolsWithFallback("GitHub OAuth integration tools list repositories stars pull requests");
    expect(out.ranking).toBe("keyword");
    expect(out.matches.map((m) => m.slug).slice(0, 2).sort()).toEqual(
      ["github__github-list-stargazers", "github__list_pull_requests"].sort(),
    );
    expect(out.matches.every((m) => m.source === "mcp:github" || m.score > 0)).toBe(true);
  });

  it("ignores generic words, so 'list tools' alone matches nothing", async () => {
    expect(await keywordSearchTools("list tools")).toEqual([]);
  });

  it("ranks a name hit above a description hit", async () => {
    const out = await keywordSearchTools("stargazers repository");
    expect(out[0]!.slug).toBe("github__github-list-stargazers");
  });
});
