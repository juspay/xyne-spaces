import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  spawns: 0,
  listCalls: 0,
  tools: [{ name: "t1", description: "d", inputSchema: { type: "object" } }] as Array<Record<string, unknown>>,
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    constructor() {
      state.spawns += 1;
    }
    async connect() {}
    async listTools() {
      state.listCalls += 1;
      return { tools: state.tools };
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
  getSpacesAuthForUser: vi.fn(async () => null),
  getWorkspaceIdForUser: vi.fn(async () => null),
}));
vi.mock("../lib/spaces-session-server-types.js", () => ({ SPACES_SESSION_CREDENTIAL_SERVER_TYPES: new Set<string>() }));
vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../crypto.js", () => ({ decrypt: (v: string) => v }));
vi.mock("../config.js", () => ({ CONFIG: {} }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { listToolsForUser, clearToolListCache } = await import("./runner.js");

let run = 0;
const user = (name: string) => `${name}-${run}`;

describe("listToolsForUser shared tool-list cache", () => {
  beforeEach(() => {
    run += 1;
    clearToolListCache();
    state.spawns = 0;
    state.listCalls = 0;
    state.tools = [{ name: "t1", description: "d", inputSchema: { type: "object" } }];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves every user from one listing for a shared-list server", async () => {
    const results = [];
    for (const name of ["u1", "u2", "u3"]) {
      results.push(await listToolsForUser(user(name), "heisenberg", "Heisenberg", {}));
    }
    expect(state.spawns).toBe(1);
    expect(state.listCalls).toBe(1);
    for (const r of results) expect(r.tools.map((t) => t.name)).toEqual(["t1"]);
  });

  it("does not spawn a per-agent app-tools server just to list tools", async () => {
    await listToolsForUser(user("u1"), "xyne-spaces-app-tools", "App Tools", {}, "agent-a");
    await listToolsForUser(user("u1"), "xyne-spaces-app-tools", "App Tools", {}, "agent-b");
    await listToolsForUser(user("u2"), "xyne-spaces-app-tools", "App Tools", {}, "agent-c");
    expect(state.spawns).toBe(1);
  });

  it("coalesces concurrent first listings onto one spawn", async () => {
    await Promise.all(
      ["u1", "u2", "u3", "u4"].map((name) => listToolsForUser(user(name), "research-agent-mcp", "Research", {})),
    );
    expect(state.spawns).toBe(1);
    expect(state.listCalls).toBe(1);
  });

  it("keeps per-user listing for servers outside the shared set", async () => {
    await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {});
    await listToolsForUser(user("u2"), "bitbucket", "Bitbucket", {});
    expect(state.spawns).toBe(2);
  });

  it("bypasses the cache when fresh is requested", async () => {
    await listToolsForUser(user("u1"), "heisenberg", "Heisenberg", {});
    await listToolsForUser(user("u2"), "heisenberg", "Heisenberg", {}, undefined, { fresh: true });
    expect(state.spawns).toBe(2);
    expect(state.listCalls).toBe(2);
  });

  it("does not cache an empty listing", async () => {
    state.tools = [];
    await listToolsForUser(user("u1"), "heisenberg", "Heisenberg", {});
    state.tools = [{ name: "t2", description: "", inputSchema: {} }];
    const second = await listToolsForUser(user("u2"), "heisenberg", "Heisenberg", {});
    expect(second.tools.map((t) => t.name)).toEqual(["t2"]);
    expect(state.listCalls).toBe(2);
  });

  it("refreshes the listing after the TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T00:00:00Z"));
    await listToolsForUser(user("u1"), "heisenberg", "Heisenberg", {});
    vi.setSystemTime(new Date("2026-09-25T00:09:00Z"));
    await listToolsForUser(user("u1"), "heisenberg", "Heisenberg", {});
    expect(state.listCalls).toBe(1);
    vi.setSystemTime(new Date("2026-09-25T00:11:00Z"));
    await listToolsForUser(user("u1"), "heisenberg", "Heisenberg", {});
    expect(state.listCalls).toBe(2);
  });
});
