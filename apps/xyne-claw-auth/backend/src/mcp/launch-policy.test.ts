/** Checks every code-defined stdio adapter's launch against the MCP service launch policy. */
import { describe, expect, it, vi } from "vitest";
import { checkLaunch, policyFromEnv } from "xyne-claw-mcp-common/launch-policy";

vi.mock("../config.js", () => ({ CONFIG: new Proxy({}, { get: () => "" }) }));
vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { STATIC_ADAPTERS } = await import("./static-adapters.js");

const policy = policyFromEnv({});

// Enough fields for every stdio adapter's buildCommand to produce a command.
const DUMMY_CREDENTIALS: Record<string, unknown> = new Proxy(
  {
    keyFile: JSON.stringify({ type: "service_account", project_id: "p", private_key: "k", client_email: "e@x" }),
    url: "https://example.com",
    host: "example.com",
    port: "8123",
    connectionString: "mongodb://example.com/db",
  },
  { get: (target, prop: string) => (prop in target ? target[prop as keyof typeof target] : "dummy") },
);

function stdioLaunches() {
  return Object.entries(STATIC_ADAPTERS).flatMap(([type, adapter]) => {
    if (adapter.transport !== "stdio") return [];
    return [{ type, ...adapter.buildCommand(DUMMY_CREDENTIALS) }];
  });
}

describe("adapter launches vs the MCP service launch policy", () => {
  it("allows the launch command of every code-defined stdio adapter", () => {
    const refused: string[] = [];
    for (const { type, cmd, args, env, files } of stdioLaunches()) {
      const reason = checkLaunch({ transport: "stdio", cmd, args, env, ...(files ? { files } : {}) }, policy);
      if (reason) refused.push(`${type}: ${reason}`);
    }
    expect(refused).toEqual([]);
  });
});
