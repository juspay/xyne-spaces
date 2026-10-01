import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the per-workspace Spaces install store.
 *
 * Regression context: `Agent.spacesAppToken`/`spacesAppUserId` hold ONE
 * (token, botUserId) pair, so installing the same app into a second workspace
 * silently overwrote the first and every outbound Spaces call for the old
 * workspace 401'd. The store keys credentials by (app, workspace) via
 * SurfaceAgent + SurfaceAgentInstall and resolves them by workspace id.
 */

interface SurfaceAgentRow {
  id: string;
  agentId: string;
  surfaceId: string;
  surfaceTenantId: string;
  externalAppId: string;
  signingSecret?: string | null;
  status?: string;
}
interface InstallRow {
  id: string;
  surfaceAgentId: string;
  surfaceTenantId: string; // the workspace id
  encryptedBotToken: string;
  botUserId?: string | null;
  installedAt: Date;
  installedByUserId?: string | null;
}

const state = vi.hoisted(() => ({
  surfaceAgents: new Map<string, SurfaceAgentRow>(),
  installs: new Map<string, InstallRow>(),
  seq: 0,
  failNext: false,
}));

function key(agentId: string, surfaceId: string, tenant: string) {
  return `${agentId}::${surfaceId}::${tenant}`;
}

vi.mock("../db.js", () => ({
  prisma: {
    surfaceAgent: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        if (state.failNext) throw new Error("db down");
        const k = key(where.agentId_surfaceId_surfaceTenantId.agentId, where.agentId_surfaceId_surfaceTenantId.surfaceId, where.agentId_surfaceId_surfaceTenantId.surfaceTenantId);
        let row = state.surfaceAgents.get(k);
        if (row) {
          Object.assign(row, update);
        } else {
          row = { id: `sa-${++state.seq}`, ...create } as SurfaceAgentRow;
          state.surfaceAgents.set(k, row);
        }
        return { id: row.id };
      }),
      findFirst: vi.fn(),
    },
    surfaceAgentInstall: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        if (state.failNext) throw new Error("db down");
        const k = `${where.surfaceAgentId_surfaceTenantId.surfaceAgentId}::${where.surfaceAgentId_surfaceTenantId.surfaceTenantId}`;
        let row = state.installs.get(k);
        if (row) {
          Object.assign(row, update);
        } else {
          row = { id: `i-${++state.seq}`, installedAt: new Date(), ...create } as InstallRow;
          state.installs.set(k, row);
        }
        return { id: row.id };
      }),
      findFirst: vi.fn(async ({ where, orderBy, select }: any) => {
        if (state.failNext) throw new Error("db down");
        let rows = [...state.installs.values()];
        if (where.surfaceTenantId !== undefined) rows = rows.filter((r) => r.surfaceTenantId === where.surfaceTenantId);
        if (where.botUserId !== undefined) rows = rows.filter((r) => r.botUserId === where.botUserId);
        if (where.surfaceAgent?.externalAppId) {
          const ids = new Set([...state.surfaceAgents.values()].filter((s) => s.externalAppId === where.surfaceAgent.externalAppId && s.surfaceId === where.surfaceAgent.surfaceId).map((s) => s.id));
          rows = rows.filter((r) => ids.has(r.surfaceAgentId));
        } else if (where.surfaceAgent?.surfaceId) {
          const ids = new Set([...state.surfaceAgents.values()].filter((s) => s.surfaceId === where.surfaceAgent.surfaceId).map((s) => s.id));
          rows = rows.filter((r) => ids.has(r.surfaceAgentId));
        }
        if (orderBy?.installedAt === "desc") rows.sort((a, b) => b.installedAt.getTime() - a.installedAt.getTime());
        else rows.sort((a, b) => a.installedAt.getTime() - b.installedAt.getTime());
        const row = rows[0];
        if (!row) return null;
        // prisma applies `select` — emulate only the fields the module asks for
        if (select?.botUserId !== undefined || select?.encryptedBotToken) {
          return {
            ...(select.encryptedBotToken !== false ? { encryptedBotToken: row.encryptedBotToken } : {}),
            ...(select.botUserId !== undefined ? { botUserId: row.botUserId ?? null } : {}),
          };
        }
        return row;
      }),
    },
    agent: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (state.failNext) throw new Error("db down");
        if (where.spacesAppUserId) {
          return (
            [...agentRows.values()].find((a) => a.spacesAppUserId === where.spacesAppUserId) ?? null
          );
        }
        return null;
      }),
    },
  },
}));

// Inline-column fallback agent rows the reverse lookup may hit
const agentRows = new Map<string, { id: string; spacesAppUserId: string; spacesAppToken: string }>();

const { ensureSpacesSurfaceAgent, upsertSpacesInstall, resolveSpacesAppCreds, resolveSpacesAppTokenByBotUser } =
  await import("./spaces-agent-install.js");

beforeEach(() => {
  state.surfaceAgents.clear();
  state.installs.clear();
  state.seq = 0;
  state.failNext = false;
  agentRows.clear();
});

const APP = "spaces-app-1";
const AGENT = "agent-1";

describe("ensureSpacesSurfaceAgent", () => {
  it("anchors ONE org-level row per agent (surfaceId=spaces, empty tenant)", async () => {
    const id1 = await ensureSpacesSurfaceAgent({ agentId: AGENT, spacesAppId: APP, signingSecret: "enc:s1" });
    const id2 = await ensureSpacesSurfaceAgent({ agentId: AGENT, spacesAppId: APP, signingSecret: "enc:s2" });
    expect(id1).toBeTruthy();
    expect(id2).toBe(id1);
    expect(state.surfaceAgents.size).toBe(1);
    const row = [...state.surfaceAgents.values()][0]!;
    expect(row.externalAppId).toBe(APP);
    expect(row.signingSecret).toBe("enc:s2"); // refresh updates in place
  });

  it("returns null instead of throwing when the DB hiccups", async () => {
    state.failNext = true;
    expect(await ensureSpacesSurfaceAgent({ agentId: AGENT, spacesAppId: APP })).toBeNull();
  });
});

describe("upsertSpacesInstall", () => {
  it("keeps DISTINCT credentials per workspace for the same app", async () => {
    await upsertSpacesInstall({ agentId: AGENT, spacesAppId: APP, workspaceId: "ws-1", botUserId: "bot-ws1", encryptedBotToken: "enc:t-ws1" });
    await upsertSpacesInstall({ agentId: AGENT, spacesAppId: APP, workspaceId: "ws-2", botUserId: "bot-ws2", encryptedBotToken: "enc:t-ws2" });

    const ws1 = [...state.installs.values()].filter((r) => r.surfaceTenantId === "ws-1");
    const ws2 = [...state.installs.values()].filter((r) => r.surfaceTenantId === "ws-2");
    expect(ws1).toHaveLength(1);
    expect(ws2).toHaveLength(1);
    expect(ws1[0]!.encryptedBotToken).toBe("enc:t-ws1");
    expect(ws2[0]!.botUserId).toBe("bot-ws2");
  });

  it("refresh is idempotent: re-installing the same workspace REPLACES that row's token only", async () => {
    await upsertSpacesInstall({ agentId: AGENT, spacesAppId: APP, workspaceId: "ws-1", botUserId: "bot-ws1", encryptedBotToken: "enc:t-ws1" });
    await upsertSpacesInstall({ agentId: AGENT, spacesAppId: APP, workspaceId: "ws-2", botUserId: "bot-ws2", encryptedBotToken: "enc:t-ws2" });
    await upsertSpacesInstall({ agentId: AGENT, spacesAppId: APP, workspaceId: "ws-1", botUserId: "bot-ws1", encryptedBotToken: "enc:t-ws1-v2" });

    expect(state.installs.size).toBe(2);
    const ws1 = [...state.installs.values()].find((r) => r.surfaceTenantId === "ws-1")!;
    const ws2 = [...state.installs.values()].find((r) => r.surfaceTenantId === "ws-2")!;
    expect(ws1.encryptedBotToken).toBe("enc:t-ws1-v2");
    expect(ws2!.encryptedBotToken).toBe("enc:t-ws2"); // untouched
  });

  it("no-ops politely when the workspace id is empty", async () => {
    await upsertSpacesInstall({ agentId: AGENT, spacesAppId: APP, workspaceId: "", encryptedBotToken: "enc:t" });
    expect(state.installs.size).toBe(0);
  });
});

describe("resolveSpacesAppCreds", () => {
  const AGENT_ROW = { spacesAppId: APP, spacesAppToken: "enc:inline-token", spacesAppUserId: "bot-inline" };

  it("resolves the caller's workspace credential, not the latest install's", async () => {
    await upsertSpacesInstall({ agentId: AGENT, spacesAppId: APP, workspaceId: "ws-1", botUserId: "bot-ws1", encryptedBotToken: "enc:t-ws1" });
    await upsertSpacesInstall({ agentId: AGENT, spacesAppId: APP, workspaceId: "ws-2", botUserId: "bot-ws2", encryptedBotToken: "enc:t-ws2" });

    // THE OLD BUG: ws-1 would have gotten ws-2's token (last writer wins on the Agent row).
    expect(await resolveSpacesAppCreds(AGENT_ROW, "ws-1")).toEqual({ spacesAppToken: "enc:t-ws1", spacesAppUserId: "bot-ws1" });
    expect(await resolveSpacesAppCreds(AGENT_ROW, "ws-2")).toEqual({ spacesAppToken: "enc:t-ws2", spacesAppUserId: "bot-ws2" });
  });

  it("falls back to the inline Agent columns when no install row exists for the workspace (pre-backfill)", async () => {
    await upsertSpacesInstall({ agentId: AGENT, spacesAppId: APP, workspaceId: "ws-2", botUserId: "bot-ws2", encryptedBotToken: "enc:t-ws2" });
    expect(await resolveSpacesAppCreds(AGENT_ROW, "ws-999")).toEqual({ spacesAppToken: "enc:inline-token", spacesAppUserId: "bot-inline" });
  });

  it("falls back to the inline columns when no workspace is in scope", async () => {
    await upsertSpacesInstall({ agentId: AGENT, spacesAppId: APP, workspaceId: "ws-1", botUserId: "bot-ws1", encryptedBotToken: "enc:t-ws1" });
    expect(await resolveSpacesAppCreds(AGENT_ROW, undefined)).toEqual({ spacesAppToken: "enc:inline-token", spacesAppUserId: "bot-inline" });
    expect(await resolveSpacesAppCreds(AGENT_ROW, null)).toEqual({ spacesAppToken: "enc:inline-token", spacesAppUserId: "bot-inline" });
  });

  it("falls back when the agent has no app bound at all", async () => {
    expect(await resolveSpacesAppCreds({ spacesAppId: null, spacesAppToken: null, spacesAppUserId: null }, "ws-1")).toEqual({ spacesAppToken: null, spacesAppUserId: null });
  });

  it("fail-open: a DB hiccup degrades to the inline columns, never throws", async () => {
    state.failNext = true;
    expect(await resolveSpacesAppCreds(AGENT_ROW, "ws-1")).toEqual({ spacesAppToken: "enc:inline-token", spacesAppUserId: "bot-inline" });
  });
});

describe("resolveSpacesAppTokenByBotUser", () => {
  it("finds the right install's encrypted token across workspaces", async () => {
    await upsertSpacesInstall({ agentId: AGENT, spacesAppId: APP, workspaceId: "ws-1", botUserId: "bot-ws1", encryptedBotToken: "enc:t-ws1" });
    await upsertSpacesInstall({ agentId: AGENT, spacesAppId: APP, workspaceId: "ws-2", botUserId: "bot-ws2", encryptedBotToken: "enc:t-ws2" });
    expect(await resolveSpacesAppTokenByBotUser("bot-ws1")).toBe("enc:t-ws1");
    expect(await resolveSpacesAppTokenByBotUser("bot-ws2")).toBe("enc:t-ws2");
  });

  it("falls back to the Agent inline columns when the bot id predates the install table", async () => {
    agentRows.set("a-1", { id: "a-1", spacesAppUserId: "legacy-bot", spacesAppToken: "enc:legacy" });
    expect(await resolveSpacesAppTokenByBotUser("legacy-bot")).toBe("enc:legacy");
  });

  it("returns null (never throws) for empty input or total miss", async () => {
    expect(await resolveSpacesAppTokenByBotUser("")).toBeNull();
    expect(await resolveSpacesAppTokenByBotUser("nobody")).toBeNull();
  });
});
