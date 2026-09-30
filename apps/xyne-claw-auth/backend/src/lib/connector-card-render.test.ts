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
const grafana = { serverTypes: ["grafana"] };
const none = { personal: new Set<string>(), org: new Set<string>(), agent: new Set<string>() };

beforeEach(() => {
  availabilityForServerIds.mockClear();
  postFlowCard.mockClear();
});

describe("renderConnectorSuggestCard — already-connected connectors", () => {
  it.each([
    ["the agent's own pin", { ...none, agent: new Set(["srv-grafana"]) }],
    ["the user's personal connection", { ...none, personal: new Set(["srv-grafana"]) }],
    ["an org-shared credential", { ...none, org: new Set(["srv-grafana"]) }],
  ])("does not offer a connector covered by %s", async (_label, availability) => {
    availabilityForServerIds.mockResolvedValueOnce(availability);

    const card = await renderConnectorSuggestCard({ suggestions: grafana, blockedConnectors: undefined, id, target });

    expect(card).toBeNull();
    expect(postFlowCard).not.toHaveBeenCalled();
    expect(availabilityForServerIds).toHaveBeenCalledWith("user-1", ["srv-grafana"], { agentSlug: "infra-doctor", agentOrgId: "org-1" });
  });

  it.each([
    ["the agent's own pin", { ...none, agent: new Set(["srv-grafana"]) }],
    ["the user's personal connection", { ...none, personal: new Set(["srv-grafana"]) }],
  ])("offers reconnecting when %s was rejected (401/403) this run", async (_label, availability) => {
    availabilityForServerIds.mockResolvedValueOnce(availability);

    const card = await renderConnectorSuggestCard({ suggestions: grafana, blockedConnectors: ["grafana"], id, target });

    expect(card).not.toBeNull();
    expect(JSON.stringify(card)).toContain('"connected":true');
  });

  it("offers it when nobody has it connected", async () => {
    const card = await renderConnectorSuggestCard({ suggestions: grafana, blockedConnectors: undefined, id, target });

    expect(card).not.toBeNull();
    expect(JSON.stringify(card)).toContain('"connected":false');
  });

  it("uses the agent's title, and no inferred-card title exists any more", async () => {
    const card = await renderConnectorSuggestCard({
      suggestions: { serverTypes: ["grafana"], title: "Connect Grafana to read p95" },
      blockedConnectors: undefined,
      id,
      target,
    });

    const json = JSON.stringify(card);
    expect(json).toContain("Connect Grafana to read p95");
    expect(json).not.toContain("Connect to unlock this");
  });
});

describe("renderConnectorSuggestCard with named connectors and listAll", () => {
  it("shows the named connector, not the roster, when both are sent", async () => {
    const card = await renderConnectorSuggestCard({
      suggestions: { serverTypes: ["grafana"], listAll: true },
      blockedConnectors: undefined,
      id,
      target,
    });

    const json = JSON.stringify(card);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { type: { in: ["grafana"] }, enabled: true } }));
    expect(json).not.toContain("Connectors you can add");
    expect(json).not.toContain('"browseAll":true');
  });
});
