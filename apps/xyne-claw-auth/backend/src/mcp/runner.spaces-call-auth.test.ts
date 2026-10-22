import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  spawns: 0,
  calls: [] as Array<Record<string, unknown>>,
  live: { token: "tok-1", sessionId: "sess-1", workspaceId: "ws-1" } as { token: string; sessionId: string; workspaceId: string } | null,
  appToken: null as string | null,
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    constructor() {
      state.spawns += 1;
    }
    async connect() {}
    async listTools() {
      return { tools: [] };
    }
    async callTool(request: Record<string, unknown>) {
      state.calls.push(request);
      return { content: [{ type: "text", text: "ok" }] };
    }
    async close() {}
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    onclose?: () => void;
    async close() {}
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    async close() {}
  },
}));
vi.mock("@modelcontextprotocol/sdk/validation/ajv", () => ({
  AjvJsonSchemaValidator: class {
    getValidator() {
      return () => ({ valid: true, data: undefined, errorMessage: undefined });
    }
  },
}));
vi.mock("../lib/mcp-tool-name-index.js", () => ({ recordKnownMcpTools: vi.fn(async () => undefined) }));
vi.mock("./connector-definitions.js", () => ({
  resolveConnectorDefinition: vi.fn(async () => ({
    transport: "stdio",
    writeTools: [],
    buildStdioCommand: () => ({ cmd: "node", args: [], env: {} }),
  })),
}));
vi.mock("./provision.js", () => ({
  provisionStdioCommand: vi.fn(async (command: string, args: string[]) => ({ command, args })),
}));
vi.mock("./static-adapters.js", () => ({ STATIC_ADAPTERS: {} }));
vi.mock("../lib/spaces-db.js", () => ({
  getSpacesAuthForUser: vi.fn(async () => state.live),
  getWorkspaceIdForUser: vi.fn(async () => "ws-1"),
}));
vi.mock("../lib/users-jit.js", () => ({ spacesUserIdForClawUser: vi.fn(async () => "spaces-user") }));
vi.mock("../db.js", () => ({
  prisma: { agent: { findFirst: vi.fn(async () => (state.appToken ? { spacesAppToken: `${state.appToken}:iv:tag` } : null)) } },
}));
vi.mock("../crypto.js", () => ({ decrypt: (v: string) => v }));
vi.mock("../config.js", () => ({ CONFIG: {} }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { callTool, evictAllSessionsForUser } = await import("./runner.js");
const { applySpacesCallAuth } = await import("./spaces-call-auth.js");

const CREDS = { url: "https://spaces.example" };
let run = 0;

describe("xyne-spaces per-call auth", () => {
  beforeEach(async () => {
    run += 1;
    state.spawns = 0;
    state.calls = [];
    state.live = { token: "tok-1", sessionId: "sess-1", workspaceId: "ws-1" };
    state.appToken = null;
  });

  it("reuses one child across token rotations and sends the current token with each call", async () => {
    const user = `u-${run}`;
    await callTool(user, "xyne-spaces", CREDS, "spaces-search", { q: "a" });
    state.live = { token: "tok-2", sessionId: "sess-2", workspaceId: "ws-1" };
    await callTool(user, "xyne-spaces", CREDS, "spaces-search", { q: "b" });
    expect(state.spawns).toBe(1);
    expect(state.calls.map((c) => c["_meta"])).toEqual([
      { xyneSpacesAuth: { token: "tok-1", sessionId: "sess-1" } },
      { xyneSpacesAuth: { token: "tok-2", sessionId: "sess-2" } },
    ]);
    await evictAllSessionsForUser(user);
  });

  it("starts a new child when the workspace changes", async () => {
    const user = `u-${run}`;
    await callTool(user, "xyne-spaces", CREDS, "spaces-search", {});
    state.live = { token: "tok-2", sessionId: "sess-1", workspaceId: "ws-2" };
    await callTool(user, "xyne-spaces", CREDS, "spaces-search", {});
    expect(state.spawns).toBe(2);
    await evictAllSessionsForUser(user);
  });

  it("starts a new child when the user switches between app and session auth", async () => {
    const user = `u-${run}`;
    state.live = null;
    state.appToken = "app-tok";
    await callTool(user, "xyne-spaces", CREDS, "spaces-search", {});
    expect(state.calls[0]?.["_meta"]).toEqual({ xyneSpacesAuth: { token: "app-tok" } });
    state.live = { token: "tok-1", sessionId: "sess-1", workspaceId: "ws-1" };
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

  it("keeps the startup token when a call carries no auth", () => {
    const env: NodeJS.ProcessEnv = { XYNE_SPACES_TOKEN: "old" };
    for (const meta of [undefined, {}, { xyneSpacesAuth: { token: "" } }, { other: 1 }]) applySpacesCallAuth(meta, env);
    expect(env).toEqual({ XYNE_SPACES_TOKEN: "old" });
  });
});
