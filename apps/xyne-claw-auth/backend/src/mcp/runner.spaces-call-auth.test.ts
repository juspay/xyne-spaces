import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  spawns: 0,
  calls: [] as Array<Record<string, unknown>>,
  live: { agentToken: "tok-1", principalId: "pr-1", workspaceId: "ws-1" } as
    | { agentToken: string; principalId: string; workspaceId: string }
    | null,
  bot: null as { token: string; botUserId: string; principalId: string; workspaceId: string } | null,
}));

const FakeClient = vi.hoisted(() => class {
  constructor() {
    state.spawns += 1;
  }
  async connect() {}
  getServerCapabilities() {
    return {};
  }
  async listTools() {
    return { tools: [] };
  }
  async callTool(request: Record<string, unknown>) {
    state.calls.push(request);
    return { content: [{ type: "text", text: "ok" }] };
  }
  async close() {}
});
vi.mock("./executor.js", async () => {
  const { createFakeMcpService } = await import("./fake-mcp-service.testkit.js");
  const service = createFakeMcpService(async () => new FakeClient());
  return { mcpExecutor: () => service, mcpServiceConfigured: () => true };
});
vi.mock("../lib/mcp-tool-name-index.js", () => ({ recordKnownMcpTools: vi.fn(async () => undefined) }));
vi.mock("./connector-definitions.js", () => ({
  resolveConnectorDefinition: vi.fn(async () => ({
    transport: "stdio",
    writeTools: [],
    buildStdioCommand: () => ({ cmd: "node", args: [], env: {} }),
  })),
}));
vi.mock("./static-adapters.js", () => ({ STATIC_ADAPTERS: {} }));
vi.mock("../surfaces/spaces/user-auth.js", () => ({
  resolveAgentSpacesAuth: vi.fn(async () => state.live),
}));
vi.mock("../lib/spaces-bot.js", () => ({
  getAgentBotAuth: vi.fn(async () => state.bot),
}));
vi.mock("../lib/users-jit.js", () => ({ spacesUserIdForClawUser: vi.fn(async () => "spaces-user") }));
vi.mock("../db.js", () => ({
  prisma: { agent: { findFirst: vi.fn(async () => null) } },
}));
vi.mock("../crypto.js", () => ({ decrypt: (v: string) => v }));
vi.mock("../config.js", () => ({ CONFIG: {} }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { callTool, evictAllSessionsForUser } = await import("./runner.js");
const { applySpacesCallAuth } = await import("xyne-claw-mcp-common/spaces-call-auth");

const CREDS = { url: "https://spaces.example", clawAgentId: "agent-1" };
let run = 0;

describe("xyne-spaces per-call auth", () => {
  beforeEach(async () => {
    run += 1;
    state.spawns = 0;
    state.calls = [];
    state.live = { agentToken: "tok-1", principalId: "pr-1", workspaceId: "ws-1" };
    state.bot = null;
  });

  it("reuses one child across token rotations and sends the current token with each call", async () => {
    const user = `u-${run}`;
    await callTool(user, "xyne-spaces", CREDS, "spaces-search", { q: "a" });
    state.live = { agentToken: "tok-2", principalId: "pr-1", workspaceId: "ws-1" };
    await callTool(user, "xyne-spaces", CREDS, "spaces-search", { q: "b" });
    expect(state.spawns).toBe(1);
    expect(state.calls.map((c) => c["_meta"])).toEqual([
      { xyneSpacesAuth: { agentToken: "tok-1" } },
      { xyneSpacesAuth: { agentToken: "tok-2" } },
    ]);
    await evictAllSessionsForUser(user);
  });

  it("starts a new child when the workspace changes", async () => {
    const user = `u-${run}`;
    await callTool(user, "xyne-spaces", CREDS, "spaces-search", {});
    state.live = { agentToken: "tok-2", principalId: "pr-1", workspaceId: "ws-2" };
    await callTool(user, "xyne-spaces", CREDS, "spaces-search", {});
    expect(state.spawns).toBe(2);
    await evictAllSessionsForUser(user);
  });

  it("starts a new child when the user switches between app and session auth", async () => {
    const user = `u-${run}`;
    state.live = null;
    state.bot = { token: "app-tok", botUserId: user, principalId: "pr-1", workspaceId: "ws-1" };
    await callTool(user, "xyne-spaces", CREDS, "spaces-search", {});
    expect(state.calls[0]?.["_meta"]).toEqual({ xyneSpacesAuth: { token: "app-tok" } });
    state.live = { agentToken: "tok-1", principalId: "pr-1", workspaceId: "ws-1" };
    await callTool(user, "xyne-spaces", CREDS, "spaces-search", {});
    expect(state.spawns).toBe(2);
    await evictAllSessionsForUser(user);
  });

  it("does not attach Spaces auth to other servers", async () => {
    const user = `u-${run}`;
    await callTool(user, "bitbucket", { token: "bb-1" }, "list", {});
    expect(state.calls[0]?.["_meta"]).toBeUndefined();
    await evictAllSessionsForUser(user);
  });
});

describe("applySpacesCallAuth", () => {
  it("swaps the token and session id the Spaces tools read", () => {
    const env: NodeJS.ProcessEnv = { XYNE_SPACES_TOKEN: "old", XYNE_SPACES_SESSION_ID: "old-sess" };
    applySpacesCallAuth({ xyneSpacesAuth: { token: "new", sessionId: "new-sess" } }, env);
    expect(env).toEqual({ XYNE_SPACES_TOKEN: "new", XYNE_SPACES_SESSION_ID: "new-sess" });
  });

  it("swaps the agent token the Spaces tools read", () => {
    const env: NodeJS.ProcessEnv = { XYNE_SPACES_AGENT_TOKEN: "old" };
    applySpacesCallAuth({ xyneSpacesAuth: { agentToken: "new" } }, env);
    expect(env).toEqual({ XYNE_SPACES_AGENT_TOKEN: "new" });
  });

  it("keeps the startup token when a call carries no auth", () => {
    const env: NodeJS.ProcessEnv = { XYNE_SPACES_TOKEN: "old" };
    for (const meta of [undefined, {}, { xyneSpacesAuth: { token: "" } }, { other: 1 }]) applySpacesCallAuth(meta, env);
    expect(env).toEqual({ XYNE_SPACES_TOKEN: "old" });
  });
});
