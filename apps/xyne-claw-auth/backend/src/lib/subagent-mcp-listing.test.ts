import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  defs: [] as Array<Record<string, any>>,
  conns: [] as Array<Record<string, any>>,
  defWhere: null as any,
  decryptImpl: (() => JSON.stringify({ apiKey: "x" })) as (...args: any[]) => string,
}));

vi.mock("../config.js", () => ({ CONFIG: { encryptionKey: Buffer.alloc(32, 7) } }));
vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../crypto.js", () => ({ decrypt: (...a: any[]) => state.decryptImpl(...a) }));
vi.mock("../db.js", () => ({
  prisma: {
    subagentDefinition: {
      findMany: vi.fn(async (args: any) => {
        state.defWhere = args.where;
        const names: string[] = args.where.name.in;
        return state.defs.filter(
          (d) =>
            names.includes(d.name) &&
            d.enabled !== false &&
            (args.where.orgId === undefined || d.orgId === args.where.orgId),
        );
      }),
    },
    subagentMcpConnection: {
      findMany: vi.fn(async (args: any) => {
        const ids: string[] = args.where.subagentDefinitionId.in;
        return state.conns.filter((c) => ids.includes(c.subagentDefinitionId));
      }),
    },
  },
}));

import { loadSubagentMcpListingEntries } from "./subagent-mcp-listing.js";

function conn(subagentDefinitionId: string, type: string, over: Record<string, any> = {}) {
  return {
    id: `conn-${type}-${subagentDefinitionId}`,
    subagentDefinitionId,
    slug: "default",
    encryptedCreds: "e",
    iv: "i",
    authTag: "t",
    mcpServer: { type, name: type, enabled: true },
    ...over,
  };
}

beforeEach(() => {
  state.defs = [
    { id: "sub-pl", name: "paymentlinks", enabled: true, orgId: "org-1" },
    { id: "sub-po", name: "payouts", enabled: true, orgId: "org-1" },
  ];
  state.conns = [
    conn("sub-pl", "juspay-dashboard-stream"),
    conn("sub-po", "juspay-dashboard-stream"),
  ];
  state.defWhere = null;
  state.decryptImpl = () => JSON.stringify({ apiKey: "x" });
});

describe("loadSubagentMcpListingEntries", () => {
  it("lists a server whose only credentials live on a subagent", async () => {
    const out = await loadSubagentMcpListingEntries({
      orgId: "org-1",
      subagentNames: ["paymentlinks", "payouts"],
      existingServerTypes: new Set(),
    });

    expect(out).toHaveLength(1);
    expect(out[0]!.serverType).toBe("juspay-dashboard-stream");
    expect(out[0]!.subagentDefinitionId).toBe("sub-pl");
    expect(out[0]!.subagentName).toBe("paymentlinks");
    expect(out[0]!.credentials).toEqual({ apiKey: "x" });
    expect(state.defWhere.orgId).toBe("org-1");
    expect(state.defWhere.enabled).toBe(true);
  });

  it("does not duplicate a server already reachable at agent/user/global level", async () => {
    const out = await loadSubagentMcpListingEntries({
      orgId: "org-1",
      subagentNames: ["paymentlinks"],
      existingServerTypes: new Set(["juspay-dashboard-stream"]),
    });

    expect(out).toEqual([]);
  });

  it("ignores subagents the agent does not reference", async () => {
    const out = await loadSubagentMcpListingEntries({
      orgId: "org-1",
      subagentNames: ["payouts"],
      existingServerTypes: new Set(),
    });

    expect(out).toHaveLength(1);
    expect(out[0]!.subagentName).toBe("payouts");
    expect(out[0]!.subagentDefinitionId).toBe("sub-po");
  });

  it("ignores a disabled subagent definition", async () => {
    state.defs = [{ id: "sub-pl", name: "paymentlinks", enabled: false, orgId: "org-1" }];

    const out = await loadSubagentMcpListingEntries({
      orgId: "org-1",
      subagentNames: ["paymentlinks"],
      existingServerTypes: new Set(),
    });

    expect(out).toEqual([]);
  });

  it("ignores a disabled MCP server", async () => {
    state.conns = [
      conn("sub-pl", "juspay-dashboard-stream", {
        mcpServer: { type: "juspay-dashboard-stream", name: "x", enabled: false },
      }),
    ];

    const out = await loadSubagentMcpListingEntries({
      orgId: "org-1",
      subagentNames: ["paymentlinks"],
      existingServerTypes: new Set(),
    });

    expect(out).toEqual([]);
  });

  it("skips a connection whose credentials cannot be decrypted", async () => {
    state.decryptImpl = () => {
      throw new Error("bad key");
    };

    const out = await loadSubagentMcpListingEntries({
      orgId: "org-1",
      subagentNames: ["paymentlinks"],
      existingServerTypes: new Set(),
    });

    expect(out).toEqual([]);
  });

  it("returns nothing when the agent configures no subagents", async () => {
    const out = await loadSubagentMcpListingEntries({
      orgId: "org-1",
      subagentNames: [],
      existingServerTypes: new Set(),
    });

    expect(out).toEqual([]);
  });
});
