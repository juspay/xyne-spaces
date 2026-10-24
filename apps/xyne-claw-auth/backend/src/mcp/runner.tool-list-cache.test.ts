import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  spawns: 0,
  listCalls: 0,
  tools: [{ name: "t1", description: "d", inputSchema: { type: "object" } }] as Array<Record<string, unknown>>,
  callError: "",
  listGate: null as Promise<void> | null,
  listError: "",
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    constructor() {
      state.spawns += 1;
    }
    async connect() {}
    async listTools() {
      state.listCalls += 1;
      if (state.listGate) await state.listGate;
      if (state.listError) throw new Error(state.listError);
      return { tools: state.tools };
    }
    async callTool() {
      throw new Error(state.callError);
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
vi.mock("../lib/mcp-tool-name-index.js", () => ({
  recordKnownMcpTools: vi.fn(async () => undefined),
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

const { listToolsForUser, clearToolListCache, evictAllSessionsForUser, callTool, restartMcpServers } = await import("./runner.js");

let run = 0;
const user = (name: string) => `${name}-${run}`;

describe("listToolsForUser shared tool-list cache", () => {
  beforeEach(() => {
    run += 1;
    clearToolListCache();
    state.spawns = 0;
    state.listCalls = 0;
    state.callError = "";
    state.listGate = null;
    state.listError = "";
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

  it("reuses a user's own listing for servers outside the shared set", async () => {
    await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", { token: "a" });
    await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", { token: "b" });
    expect(state.listCalls).toBe(1);
  });

  it("keeps a per-user listing with no expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T00:00:00Z"));
    await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {});
    state.tools = [{ name: "t2", description: "", inputSchema: {} }];
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    const later = await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {});
    expect(later.tools.map((t) => t.name)).toEqual(["t1"]);
    expect(state.listCalls).toBe(1);
  });

  it("lists again after the user's sessions are evicted", async () => {
    await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {});
    await evictAllSessionsForUser(user("u1"));
    await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {});
    expect(state.listCalls).toBe(2);
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

  it("keeps the shared listing for the life of the pod", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T00:00:00Z"));
    await listToolsForUser(user("u1"), "heisenberg", "Heisenberg", {});
    state.tools = [{ name: "t2", description: "", inputSchema: {} }];
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    const later = await listToolsForUser(user("u2"), "heisenberg", "Heisenberg", {});
    expect(later.tools.map((t) => t.name)).toEqual(["t1"]);
    expect(state.listCalls).toBe(1);
  });

  it("shares built-in servers with fixed tool lists across users", async () => {
    for (const name of ["u1", "u2", "u3"]) {
      await listToolsForUser(user(name), "xyne-workflows", "Workflows", { token: name, workspaceId: name });
      await listToolsForUser(user(name), "google", "Google", { token: name });
    }
    expect(state.listCalls).toBe(2);
  });

  it("restart drops every tool list and closes every session", async () => {
    await listToolsForUser(user("u1"), "heisenberg", "Heisenberg", {});
    await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {});
    const result = await restartMcpServers();
    expect(result.toolLists).toBe(2);
    state.tools = [{ name: "t2", description: "", inputSchema: {} }];
    const shared = await listToolsForUser(user("u2"), "heisenberg", "Heisenberg", {});
    const own = await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {});
    expect(shared.tools.map((t) => t.name)).toEqual(["t2"]);
    expect(own.tools.map((t) => t.name)).toEqual(["t2"]);
    expect(state.listCalls).toBe(4);
  });

  it("restart of one server type leaves the others cached", async () => {
    await listToolsForUser(user("u1"), "heisenberg", "Heisenberg", {});
    await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {});
    await restartMcpServers("bitbucket");
    await listToolsForUser(user("u2"), "heisenberg", "Heisenberg", {});
    await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {});
    expect(state.listCalls).toBe(3);
  });

  it("drops cached listings when a call names a tool the server no longer has", async () => {
    await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {});
    await listToolsForUser(user("u1"), "heisenberg", "Heisenberg", {});
    state.callError = "MCP error -32602: Tool old_tool not found";
    await expect(callTool(user("u1"), "bitbucket", {}, "old_tool", {})).rejects.toThrow(/not found/);
    await expect(callTool(user("u1"), "heisenberg", {}, "old_tool", {})).rejects.toThrow(/not found/);
    await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {});
    await listToolsForUser(user("u1"), "heisenberg", "Heisenberg", {});
    expect(state.listCalls).toBe(4);
  });

  it("keeps cached listings when a call fails for another reason", async () => {
    await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {});
    state.callError = "upstream 502";
    await expect(callTool(user("u1"), "bitbucket", {}, "t1", {})).rejects.toThrow(/502/);
    await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {});
    expect(state.listCalls).toBe(1);
  });
});

describe("listToolsForUser cutoff for slow or failing servers", () => {
  const CUT = { cutoff: true };
  beforeEach(() => {
    run += 1;
    clearToolListCache();
    state.listCalls = 0;
    state.listGate = null;
    state.listError = "";
    state.tools = [{ name: "t1", description: "d", inputSchema: { type: "object" } }];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up on a hanging server at the cutoff, skips it, then serves the late result", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    state.listGate = new Promise<void>((resolve) => { release = resolve; });
    const first = listToolsForUser(user("u1"), "heisenberg", "Heisenberg", {}, undefined, CUT);
    const firstResult = expect(first).rejects.toThrow(/exceeded 1000ms/);
    await vi.advanceTimersByTimeAsync(1_000);
    await firstResult;
    await expect(listToolsForUser(user("u2"), "heisenberg", "Heisenberg", {}, undefined, CUT)).rejects.toThrow(/skipped/);
    release();
    await vi.advanceTimersByTimeAsync(0);
    const late = await listToolsForUser(user("u3"), "heisenberg", "Heisenberg", {}, undefined, CUT);
    expect(late.tools.map((t) => t.name)).toEqual(["t1"]);
    expect(state.listCalls).toBe(1);
  });

  it("skips a failing server for the backoff window, then retries", async () => {
    vi.useFakeTimers();
    state.listError = "connect ECONNREFUSED";
    await expect(listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {}, undefined, CUT)).rejects.toThrow(/ECONNREFUSED/);
    await expect(listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {}, undefined, CUT)).rejects.toThrow(/skipped/);
    expect(state.listCalls).toBe(1);
    state.listError = "";
    await vi.advanceTimersByTimeAsync(300_001);
    const tools = await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {}, undefined, CUT);
    expect(tools.tools).toHaveLength(1);
    expect(state.listCalls).toBe(2);
  });

  it("retries right away after the user reconnects or an admin restarts the server", async () => {
    state.listError = "401 bad credentials";
    await expect(listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {}, undefined, CUT)).rejects.toThrow(/401/);
    await expect(listToolsForUser(user("u2"), "heisenberg", "Heisenberg", {}, undefined, CUT)).rejects.toThrow(/401/);
    state.listError = "";
    await evictAllSessionsForUser(user("u1"));
    await restartMcpServers("heisenberg");
    await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {}, undefined, CUT);
    await listToolsForUser(user("u2"), "heisenberg", "Heisenberg", {}, undefined, CUT);
    expect(state.listCalls).toBe(4);
  });

  it("does not apply the cutoff or skip to fresh health-check listings", async () => {
    state.listError = "boom";
    await expect(listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {}, undefined, CUT)).rejects.toThrow(/boom/);
    state.listError = "";
    const fresh = await listToolsForUser(user("u1"), "bitbucket", "Bitbucket", {}, undefined, { fresh: true });
    expect(fresh.tools).toHaveLength(1);
  });

  it("leaves callers without the cutoff option waiting for the listing", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    state.listGate = new Promise<void>((resolve) => { release = resolve; });
    const pending = listToolsForUser(user("u1"), "heisenberg", "Heisenberg", {});
    await vi.advanceTimersByTimeAsync(20_000);
    release();
    expect((await pending).tools).toHaveLength(1);
  });
});
