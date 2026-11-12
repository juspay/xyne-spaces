import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  byWorkspace: vi.fn(),
  all: vi.fn(),
  auth: vi.fn(),
}));
vi.mock("../config.js", () => ({ CONFIG: { spacesInternalUrl: "http://spaces.internal:3000/" } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("./spaces-agent-client.js", () => ({
  findPrincipalForAgent: m.byWorkspace,
  findActivePrincipalsForAgent: m.all,
  getAgentAuth: m.auth,
}));

import { AgentNotInWorkspaceError, botBearer, botUserIdFor, getAgentBotAuth, spacesBotUrl } from "./spaces-bot.js";

const p = (id: string, ws: string, status = "ACTIVE") => ({ id, workspaceId: ws, orgId: "o", clawAgentId: "agent1", name: "A", botUserId: `bot-${ws}`, status });

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockImplementation(async ({ principalId }: { principalId: string }) => ({ agentToken: `tok-${principalId}` }));
});

describe("spaces bot", () => {
  it("bot URLs go to the agent bot API, never /api/apps", () => {
    expect(spacesBotUrl("/chat/postMessage")).toBe("http://spaces.internal:3000/api/claw-agents/bot/chat/postMessage");
  });

  it("uses the agent's principal in the given workspace, as the agent itself", async () => {
    m.byWorkspace.mockResolvedValue(p("p1", "ws1"));
    expect(await getAgentBotAuth("agent1", "ws1")).toEqual({ token: "tok-p1", botUserId: "bot-ws1", principalId: "p1", workspaceId: "ws1" });
    expect(m.auth).toHaveBeenCalledWith({ principalId: "p1" });
  });

  it("without a workspace, uses the agent's only workspace", async () => {
    m.all.mockResolvedValue([p("p2", "ws2")]);
    expect((await getAgentBotAuth("agent1"))?.workspaceId).toBe("ws2");
  });

  it("refuses when the agent is in several workspaces and none is given", async () => {
    m.all.mockResolvedValue([p("p1", "ws1"), p("p2", "ws2")]);
    expect(await getAgentBotAuth("agent1")).toBeNull();
    expect(m.auth).not.toHaveBeenCalled();
  });

  it("refuses an agent not added (or disabled) in the workspace — no stored-token fallback", async () => {
    m.byWorkspace.mockResolvedValue(null);
    expect(await getAgentBotAuth("agent1", "ws9")).toBeNull();
    m.byWorkspace.mockResolvedValue(p("p1", "ws1", "DISABLED"));
    expect(await getAgentBotAuth("agent1", "ws1")).toBeNull();
    expect(m.auth).not.toHaveBeenCalled();
    await expect(botBearer({ clawAgentId: "agent1", workspaceId: "ws1" })).rejects.toBeInstanceOf(AgentNotInWorkspaceError);
    expect(await botUserIdFor({ clawAgentId: "agent1", workspaceId: "ws1" })).toBe("");
  });

  it("a Spaces failure means no token, not an exception at the call site", async () => {
    m.byWorkspace.mockRejectedValue(new Error("spaces down"));
    expect(await getAgentBotAuth("agent1", "ws1")).toBeNull();
  });
});
