import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn(async () => [
  { id: "srv-grafana", type: "grafana", name: "Grafana", description: "Metrics and alerting dashboards", connectorMeta: null },
]);
const availabilityForServerIds = vi.fn(async (..._args: unknown[]) => ({ personal: new Set<string>(), org: new Set<string>(), agent: new Set<string>() }));
const postFlowCard = vi.fn(async (flow: unknown) => flow);

vi.mock("../db.js", () => ({ prisma: { mcpServer: { findMany, count: vi.fn(async () => 1) } } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../repositories/index.js", () => ({ userProviderCredentialsRepository: {} }));
vi.mock("../routes/servers.js", () => ({ isVisibleToUser: () => true, parseConnectorMeta: () => ({}) }));
vi.mock("./connector-availability.js", () => ({ availabilityForServerIds }));
vi.mock("./flow-card-delivery.js", () => ({ postFlowCard }));

const { renderConnectorSuggestCard } = await import("./connector-card-render.js");

const id = { agentSlug: "infra-doctor", agentOrgId: "org-1", userId: "user-1", conversationId: "conv-1", channelId: "ch-1", spacesAppId: "app-1" };
const target = { kind: "spaces" as const } as never;
const inferredGrafana = { serverTypes: ["grafana"], inferred: true };

beforeEach(() => {
  availabilityForServerIds.mockClear();
  postFlowCard.mockClear();
});

describe("renderConnectorSuggestCard with agent-level credentials", () => {
  it("does not offer a connector the agent already has", async () => {
    availabilityForServerIds.mockResolvedValueOnce({ personal: new Set(), org: new Set(), agent: new Set(["srv-grafana"]) });

    const card = await renderConnectorSuggestCard({ suggestions: inferredGrafana, blockedConnectors: undefined, taskText: "why is grafana alert firing", id, target });

    expect(card).toBeNull();
    expect(postFlowCard).not.toHaveBeenCalled();
    expect(availabilityForServerIds).toHaveBeenCalledWith("user-1", ["srv-grafana"], { agentSlug: "infra-doctor", agentOrgId: "org-1" });
  });

  it("still offers it when the agent's credentials were rejected in this run", async () => {
    availabilityForServerIds.mockResolvedValueOnce({ personal: new Set(), org: new Set(), agent: new Set(["srv-grafana"]) });

    const card = await renderConnectorSuggestCard({ suggestions: inferredGrafana, blockedConnectors: ["grafana"], taskText: "check grafana", id, target });

    expect(card).not.toBeNull();
    expect(JSON.stringify(card)).toContain('"connected":true');
  });

  it("offers it when nobody has it connected", async () => {
    const card = await renderConnectorSuggestCard({ suggestions: inferredGrafana, blockedConnectors: undefined, taskText: "check grafana", id, target });

    expect(card).not.toBeNull();
    expect(JSON.stringify(card)).toContain('"connected":false');
  });
});
