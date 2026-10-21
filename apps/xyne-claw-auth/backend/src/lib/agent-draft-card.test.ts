import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
const findBySlug = vi.fn();
vi.mock("../repositories/index.js", () => ({ agentRepository: { findBySlug }, chatMessageRepository: {} }));
vi.mock("../repositories/agentRequestRepository.js", () => ({ agentRequestRepository: {} }));
vi.mock("../routes/tools.js", () => ({ buildAvailableToolsCatalog: vi.fn() }));
vi.mock("../surfaces/spaces/post-message.js", () => ({ postAgentMessage: vi.fn() }));
vi.mock("./flow-card-delivery.js", () => ({ postFlowCard: vi.fn() }));

const { createAgentQueueError, draftCardCarriesReply, draftSpecFromCreateAgentParams } = await import("./agent-draft-card.js");

const base = {
  name: "PR Review Agent",
  description: "Reviews pull requests",
  systemPrompt: "You are PR Review Agent. When given a pull request, you review it.",
};

describe("draftSpecFromCreateAgentParams", () => {
  it("keeps the required fields and defaults the rest", () => {
    const spec = draftSpecFromCreateAgentParams({ ...base });

    expect(spec).toMatchObject({ name: base.name, description: base.description, tools: [] });
    expect(spec?.systemPrompt).toBe(base.systemPrompt);
  });

  it("derives a slug from the name when none is given", () => {
    expect(draftSpecFromCreateAgentParams({ ...base })?.slug).toBe("pr-review-agent");
    expect(draftSpecFromCreateAgentParams({ ...base, name: "  Weird   Name!! " })?.slug).toBe("weird-name");
    expect(draftSpecFromCreateAgentParams({ ...base, name: "--- Dashed --- Name ---" })?.slug).toBe("dashed-name");
  });

  it("derives a slug from a long run of separators in linear time", () => {
    const name = `a${"-".repeat(100_000)}b${"-".repeat(100_000)}`;
    const started = performance.now();
    expect(draftSpecFromCreateAgentParams({ ...base, name })?.slug).toBe("a-b");
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("prefers an explicit slug", () => {
    expect(draftSpecFromCreateAgentParams({ ...base, slug: "pr-bot" })?.slug).toBe("pr-bot");
  });

  it("rejects a draft with no name or no prompt", () => {
    expect(draftSpecFromCreateAgentParams({ description: "x", systemPrompt: "y" })).toBeNull();
    expect(draftSpecFromCreateAgentParams({ name: "x", description: "y" })).toBeNull();
    expect(draftSpecFromCreateAgentParams({ ...base, name: "   " })).toBeNull();
  });

  it("rejects a name that cannot produce a slug", () => {
    expect(draftSpecFromCreateAgentParams({ ...base, name: "!!!" })).toBeNull();
  });

  it("carries the fields propose-agent supports", () => {
    const spec = draftSpecFromCreateAgentParams({
      ...base,
      tools: ["web-search", "spaces"],
      mcps: ["github"],
      skills: ["release-notes"],
      providerOrder: ["claude"],
      knowledge: { scope: "COLLECTIONS", collections: ["c1"] },
      memory: { enabled: true },
      scope: "global",
      summary: "Granted web-search and GitHub.",
      modelId: "claude-sonnet-5",
      color: "#6366f1",
    });

    expect(spec).toMatchObject({
      tools: ["web-search", "spaces"],
      mcps: ["github"],
      skills: ["release-notes"],
      providerOrder: ["claude"],
      knowledge: { scope: "COLLECTIONS", collections: ["c1"] },
      memory: { enabled: true },
      scope: "global",
      summary: "Granted web-search and GitHub.",
      modelId: "claude-sonnet-5",
      color: "#6366f1",
    });
  });

  it("drops non-string list entries instead of trusting them", () => {
    const spec = draftSpecFromCreateAgentParams({
      ...base,
      tools: ["web-search", 42, null, "  ", "spaces"],
      mcps: "github",
    });

    expect(spec?.tools).toEqual(["web-search", "spaces"]);
    expect(spec?.mcps).toBeUndefined();
  });

  it("omits an unrecognised scope rather than guessing", () => {
    expect(draftSpecFromCreateAgentParams({ ...base, scope: "everyone" })?.scope).toBeUndefined();
    expect(draftSpecFromCreateAgentParams({ ...base, scope: "personal" })?.scope).toBe("personal");
  });

  it("omits malformed knowledge and memory objects", () => {
    const spec = draftSpecFromCreateAgentParams({ ...base, knowledge: "all", memory: true });

    expect(spec?.knowledge).toBeUndefined();
    expect(spec?.memory).toBeUndefined();
  });
});

describe("createAgentQueueError", () => {
  it("refuses a slug that already names an agent in the org", async () => {
    findBySlug.mockResolvedValueOnce({ name: "PR Review Agent" });

    const error = await createAgentQueueError({ ...base }, "org-1");

    expect(findBySlug).toHaveBeenLastCalledWith("pr-review-agent", "org-1");
    expect(error).toContain("already exists");
    expect(error).toContain("`pr-review-agent`");
  });

  it("lets a new slug through", async () => {
    findBySlug.mockResolvedValueOnce(null);

    expect(await createAgentQueueError({ ...base }, "org-1")).toBeNull();
  });

  it("leaves params that are not a usable draft to the write card", async () => {
    findBySlug.mockClear();

    expect(await createAgentQueueError({ description: "x" }, "org-1")).toBeNull();
    expect(findBySlug).not.toHaveBeenCalled();
  });
});

describe("draftCardCarriesReply", () => {
  const draftOnly = {
    completed: true,
    conversation: true,
    actions: [{ rendersDraftCard: true, rejected: false }],
    hasAttachments: false,
    hasPendingResponses: false,
    replyText: "Done — approve the card above to create it.",
  };

  it("lets the draft card stand in for a short reply about it", () => {
    expect(draftCardCarriesReply(draftOnly)).toBe(true);
    expect(draftCardCarriesReply({ ...draftOnly, replyText: "" })).toBe(true);
  });

  it("keeps the reply when it carries more than the draft", () => {
    expect(draftCardCarriesReply({ ...draftOnly, replyText: "x".repeat(501) })).toBe(false);
    expect(draftCardCarriesReply({ ...draftOnly, hasAttachments: true })).toBe(false);
    expect(draftCardCarriesReply({ ...draftOnly, hasPendingResponses: true })).toBe(false);
  });

  it("keeps the reply when any action is not a posted draft card", () => {
    expect(draftCardCarriesReply({ ...draftOnly, actions: [] })).toBe(false);
    expect(draftCardCarriesReply({ ...draftOnly, actions: [{ rendersDraftCard: true, rejected: true }] })).toBe(false);
    expect(
      draftCardCarriesReply({
        ...draftOnly,
        actions: [{ rendersDraftCard: true, rejected: false }, { rendersDraftCard: false, rejected: false }],
      }),
    ).toBe(false);
  });

  it("keeps the reply outside a completed conversation run", () => {
    expect(draftCardCarriesReply({ ...draftOnly, completed: false })).toBe(false);
    expect(draftCardCarriesReply({ ...draftOnly, conversation: false })).toBe(false);
  });
});
