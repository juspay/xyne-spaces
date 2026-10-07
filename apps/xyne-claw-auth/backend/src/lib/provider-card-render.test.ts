import { beforeEach, describe, expect, it, vi } from "vitest";

const listByUser = vi.fn(async (..._args: unknown[]) => [] as Array<{ provider: string; sharedCredentialId?: string }>);
const postFlowCard = vi.fn(async (flow: unknown) => flow);

vi.mock("../db.js", () => ({ prisma: { mcpServer: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) } } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../repositories/index.js", () => ({ userProviderCredentialsRepository: { listByUser } }));
vi.mock("../routes/servers.js", () => ({ isVisibleToUser: () => true, parseConnectorMeta: () => ({}) }));
vi.mock("./connector-availability.js", () => ({ availabilityForServerIds: vi.fn() }));
vi.mock("./flow-card-delivery.js", () => ({ postFlowCard }));

const { renderProviderSuggestCard } = await import("./connector-card-render.js");

const id = {
  agentSlug: "newton-doctor",
  agentOrgId: "org-1",
  userId: "user-1",
  conversationId: "conv-1",
  channelId: "ch-1",
  spacesAppId: "app-1",
};
const target = { kind: "spaces" as const } as never;

const providersOf = (flow: unknown): Array<{ provider: string; connected: boolean }> =>
  ((flow as { components?: Array<{ props?: { providers?: Array<{ provider: string; connected: boolean }> } }> })
    .components?.[0]?.props?.providers ?? []);

beforeEach(() => {
  listByUser.mockClear();
  listByUser.mockResolvedValue([]);
  postFlowCard.mockClear();
});

describe("renderProviderSuggestCard — named suggestions", () => {
  it("offers a provider the user has not connected", async () => {
    const card = await renderProviderSuggestCard({ suggestions: { providers: ["claude"] }, id, target });

    expect(card).not.toBeNull();
    expect(providersOf(card).map((p) => p.provider)).toEqual(["claude"]);
  });

  it("drops a provider the user is already connected to", async () => {
    listByUser.mockResolvedValue([{ provider: "codex" }]);

    const card = await renderProviderSuggestCard({ suggestions: { providers: ["codex"] }, id, target });

    expect(card).toBeNull();
    expect(postFlowCard).not.toHaveBeenCalled();
  });

  it("keeps only the unconnected ones when a call names both", async () => {
    listByUser.mockResolvedValue([{ provider: "codex" }]);

    const card = await renderProviderSuggestCard({ suggestions: { providers: ["codex", "claude"] }, id, target });

    expect(providersOf(card).map((p) => p.provider)).toEqual(["claude"]);
  });

  it("never offers spaces, which needs no connecting", async () => {
    const card = await renderProviderSuggestCard({ suggestions: { providers: ["spaces"] }, id, target });

    expect(card).toBeNull();
  });

  it("resolves the aliases users actually type", async () => {
    const card = await renderProviderSuggestCard({ suggestions: { providers: ["anthropic"] }, id, target });

    expect(providersOf(card).map((p) => p.provider)).toEqual(["claude"]);
  });

  it("renders nothing for a provider Xyne does not carry", async () => {
    const card = await renderProviderSuggestCard({ suggestions: { providers: ["gemini"] }, id, target });

    expect(card).toBeNull();
    expect(postFlowCard).not.toHaveBeenCalled();
  });
});

describe("renderProviderSuggestCard — roster", () => {
  it("shows every provider with its state, connected ones included", async () => {
    listByUser.mockResolvedValue([{ provider: "codex" }]);

    const card = await renderProviderSuggestCard({ suggestions: { providers: [], listAll: true }, id, target });

    const shown = providersOf(card);
    expect(shown.length).toBeGreaterThan(1);
    expect(shown.find((p) => p.provider === "codex")?.connected).toBe(true);
    expect(shown.find((p) => p.provider === "claude")?.connected).toBe(false);
  });

  it("lets named providers win over a roster flag, matching suggest-providers", async () => {
    const card = await renderProviderSuggestCard({
      suggestions: { providers: ["claude"], listAll: true },
      id,
      target,
    });

    expect(providersOf(card).map((p) => p.provider)).toEqual(["claude"]);
  });
});
