import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = {
  user: { findUnique: vi.fn(async () => ({ orgId: "org-user" }) as { orgId: string } | null) },
  userMcpConnection: { findMany: vi.fn(async () => [] as unknown[]) },
  mcpServer: { findMany: vi.fn(async () => [] as unknown[]) },
  agentMcpConnection: { findMany: vi.fn(async (_args: unknown) => [] as unknown[]) },
};
vi.mock("../db.js", () => ({ prisma }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const { availabilityForServerIds, availableServerTypes } = await import("./connector-availability.js");

beforeEach(() => {
  for (const model of Object.values(prisma)) for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockClear();
  prisma.agentMcpConnection.findMany.mockResolvedValue([]);
});

describe("availabilityForServerIds", () => {
  it("reports connectors the run's agent has credentials for", async () => {
    prisma.agentMcpConnection.findMany.mockResolvedValue([{ mcpServerId: "srv-grafana" }]);

    const out = await availabilityForServerIds("user-1", ["srv-grafana", "srv-figma"], { agentSlug: "infra-doctor", agentOrgId: "org-agent" });

    expect([...out.agent]).toEqual(["srv-grafana"]);
    expect(prisma.agentMcpConnection.findMany).toHaveBeenCalledWith({
      where: { mcpServerId: { in: ["srv-grafana", "srv-figma"] }, agent: { slug: "infra-doctor", orgId: "org-agent" } },
      select: { mcpServerId: true },
    });
  });

  it("falls back to the user's org for the agent, and skips the agent lookup without an agent", async () => {
    await availabilityForServerIds("user-1", ["srv-grafana"], { agentSlug: "infra-doctor" });
    const query = prisma.agentMcpConnection.findMany.mock.calls[0]?.[0] as { where: { agent: unknown } } | undefined;
    expect(query?.where.agent).toEqual({ slug: "infra-doctor", orgId: "org-user" });

    prisma.agentMcpConnection.findMany.mockClear();
    const out = await availabilityForServerIds("user-1", ["srv-grafana"]);
    expect(prisma.agentMcpConnection.findMany).not.toHaveBeenCalled();
    expect(out.agent.size).toBe(0);
  });
});

describe("availableServerTypes", () => {
  it("includes the agent's own connector types", async () => {
    prisma.agentMcpConnection.findMany.mockResolvedValue([{ mcpServer: { type: "grafana" } }]);

    const out = await availableServerTypes("user-1", ["grafana", "figma"], { agentSlug: "infra-doctor" });

    expect([...out]).toEqual(["grafana"]);
  });
});
