import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueueOutbound = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./delivery.js", () => ({ enqueueOutbound }));
const resumeTyping = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./interim.js", () => ({ resumeTyping }));
const askChannelQuestions = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./questions.js", () => ({ askChannelQuestions }));
const parkOptions = vi.fn(async (..._args: unknown[]) => undefined);
let tokenSeq = 0;
vi.mock("./cards.js", () => ({ newCardToken: () => `tok${++tokenSeq}`, parkOptions }));
const mintConnectLink = vi.fn(async (grant: { serverType: string }) => `https://claw.test/connect/${grant.serverType}`);
vi.mock("./connect.js", () => ({ mintConnectLink }));
const resolveSuggestedConnectors = vi.fn();
vi.mock("../../lib/connector-card-render.js", () => ({ resolveSuggestedConnectors }));
const agentRows = [
  { slug: "pr-bot", name: "PR Bot", description: "Reviews pull requests" },
  { slug: "standup", name: "Standup", description: null },
];
vi.mock("../../db.js", () => ({
  prisma: {
    mcpServer: { findUnique: async () => ({ name: "Gmail", description: "Read and send mail" }) },
    agent: {
      findFirst: async ({ where }: { where: { slug: string } }) => agentRows.find((a) => a.slug === where.slug) ?? null,
      findMany: async ({ where }: { where: { slug?: { in: string[] } } }) =>
        where.slug ? agentRows.filter((a) => where.slug!.in.includes(a.slug)) : agentRows,
      count: async () => 14,
    },
  },
}));
vi.mock("../../repositories/index.js", () => ({ userProviderCredentialsRepository: { listByUser: async () => [{ provider: "codex" }] } }));

let interactive: Record<string, unknown> | undefined = { buttons: 3, buttonTitleChars: 20, listRows: 10, cta: true };
vi.mock("./plugin.js", () => ({ getChannel: () => ({ capabilities: { interactive } }) }));

const { widgetItems, chartAsText, deliverChannelWidget, deliverChannelConnectorCards, deliverChannelProviderCards, deliverChannelAgentCards } =
  await import("./widgets.js");

const target = { channel: "whatsapp-cloud", connectedSurfaceId: "acc", accountKey: "acct_1", chatId: "919", senderId: "919", isGroup: false } as const;

beforeEach(() => {
  enqueueOutbound.mockClear();
  resumeTyping.mockClear();
  askChannelQuestions.mockClear();
  parkOptions.mockClear();
  mintConnectLink.mockClear();
  resolveSuggestedConnectors.mockReset();
  tokenSeq = 0;
  interactive = { buttons: 3, buttonTitleChars: 20, listRows: 10, cta: true };
});

describe("widgetItems", () => {
  it("sends short code inline and long code as a text document", () => {
    const short = widgetItems({ id: "c", type: "code", operation: "create", payload: { code: "x = 1", language: "python" } }, "919");
    expect(short).toEqual([{ kind: "text", chatId: "919", text: "```python\nx = 1\n```" }]);

    const code = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
    const long = widgetItems({ id: "c", type: "code", operation: "create", payload: { code, language: "typescript" } }, "919");
    expect(long[0]).toMatchObject({ kind: "file", caption: "typescript · 80 lines" });
    const file = long[0]?.kind === "file" ? long[0].attachment : null;
    expect(file).toMatchObject({ fileName: "snippet.ts", mimeType: "text/plain" });
    expect(Buffer.from(file!.data, "base64").toString("utf8")).toBe(code);
  });

  it("summarises a diff with its line counts", () => {
    const patch = "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1,2 @@\n-old\n+new\n+more";
    const items = widgetItems({ id: "d", type: "diff", operation: "create", payload: { path: "src/x.ts", patch } }, "919");
    expect(items[0]).toMatchObject({ kind: "text" });
    expect(items[0]?.kind === "text" && items[0].text).toContain("**src/x.ts** · +2 −1");
  });

  it("has nothing to send for a plan, and leaves questions to questions.ts", () => {
    expect(widgetItems({ id: "plan", type: "plan", operation: "upsert", payload: { todos: [] } }, "919")).toEqual([]);
  });
});

describe("chartAsText", () => {
  it("lists categories largest first, with shares for a pie", () => {
    const text = chartAsText({ type: "pie", caption: "Tickets by team", points: [{ label: "Infra", value: 10 }, { label: "Web", value: 30 }] });
    expect(text.split("\n")).toEqual(["**Tickets by team**", "- Web: 30 (75%)", "- Infra: 10 (25%)"]);
  });

  it("describes a series by where it started, ended and peaked", () => {
    const text = chartAsText({
      type: "line",
      series: [
        { x: "Mon", y: 4 },
        { x: "Tue", y: 9 },
        { x: "Wed", y: 2 },
      ],
    });
    expect(text).toBe("- 4 (Mon) → 2 (Wed), high 9 on Tue, low 2 on Wed");
  });
});

describe("deliverChannelWidget", () => {
  it("asks questions through the question flow", async () => {
    await deliverChannelWidget({
      target,
      userId: "u1",
      agentSlug: "assistant",
      widget: { id: "question:q", type: "question", operation: "create", payload: { questionId: "q", questions: [{ id: "a", question: "?", type: "open_ended" }] } },
    });
    expect(askChannelQuestions).toHaveBeenCalledWith(expect.objectContaining({ questionId: "q", userId: "u1", agentSlug: "assistant" }));
  });

  it("puts typing back up after a mid-run card", async () => {
    await deliverChannelWidget({ target, userId: "u1", widget: { id: "c", type: "chart", operation: "create", payload: { type: "bar", points: [{ label: "a", value: 1 }] } } });
    expect(enqueueOutbound).toHaveBeenCalledTimes(1);
    expect(resumeTyping).toHaveBeenCalledWith(target);
  });
});

describe("deliverChannelConnectorCards", () => {
  const suggestions = { serverTypes: ["google"] };

  it("sends one Connect button straight to the sign-in for a single connector", async () => {
    resolveSuggestedConnectors.mockResolvedValue({ listAll: false, connectors: [{ serverType: "google", name: "Google", description: "Gmail and Calendar", connected: false }] });
    await deliverChannelConnectorCards({ target, userId: "u1", agentSlug: "assistant", suggestions });
    expect(mintConnectLink).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", serverType: "google", agentSlug: "assistant", target }));
    expect(enqueueOutbound.mock.calls[0]?.[1]).toMatchObject({
      kind: "card",
      card: { kind: "cta", label: "Connect", url: "https://claw.test/connect/google" },
    });
  });

  it("offers several as a list whose rows each answer with their own link", async () => {
    resolveSuggestedConnectors.mockResolvedValue({
      listAll: false,
      connectors: [
        { serverType: "google", name: "Google", connected: false },
        { serverType: "jira", name: "Jira", connected: false },
      ],
    });
    await deliverChannelConnectorCards({ target, userId: "u1", suggestions: { serverTypes: ["google", "jira"] } });
    expect(mintConnectLink).not.toHaveBeenCalled();
    const parked = parkOptions.mock.calls[0]?.[1] as Array<{ option: { action: unknown } }>;
    expect(parked.map((p) => p.option.action)).toEqual([
      { kind: "connect", serverType: "google" },
      { kind: "connect", serverType: "jira" },
    ]);
    expect(enqueueOutbound.mock.calls[0]?.[1]).toMatchObject({ kind: "card", card: { kind: "list" } });
  });

  it("writes every link inline on a channel without native cards", async () => {
    interactive = undefined;
    resolveSuggestedConnectors.mockResolvedValue({
      listAll: true,
      connectors: [
        { serverType: "google", name: "Google", connected: true },
        { serverType: "jira", name: "Jira", connected: false },
      ],
    });
    await deliverChannelConnectorCards({ target, userId: "u1", suggestions: { serverTypes: [], listAll: true } });
    const item = enqueueOutbound.mock.calls[0]?.[1] as { kind: string; text: string };
    expect(item.kind).toBe("text");
    expect(item.text).toContain("- **Google** (connected)");
    expect(item.text).toContain("- **Jira**: https://claw.test/connect/jira");
  });

  it("sends nothing when there is nothing left to connect", async () => {
    resolveSuggestedConnectors.mockResolvedValue(null);
    expect(await deliverChannelConnectorCards({ target, userId: "u1", suggestions })).toBe(false);
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });
});

describe("deliverChannelProviderCards", () => {
  it("points at settings, skipping providers already connected", async () => {
    expect(await deliverChannelProviderCards({ target, userId: "u1", suggestions: { providers: ["codex"] } })).toBe(false);
    await deliverChannelProviderCards({ target, userId: "u1", suggestions: { providers: ["claude"] } });
    expect(enqueueOutbound.mock.calls[0]?.[1]).toMatchObject({ kind: "card", card: { kind: "cta", label: "Open settings" } });
  });
});

describe("deliverChannelAgentCards", () => {
  it("offers one agent as a button that starts a chat with it", async () => {
    await deliverChannelAgentCards({ target, userId: "u1", orgId: "o", card: { variant: "profile", slug: "pr-bot" } });
    expect(enqueueOutbound.mock.calls[0]?.[1]).toMatchObject({
      kind: "card",
      card: { kind: "buttons", body: "**PR Bot** (/pr-bot)\n\nReviews pull requests", buttons: [{ title: "Chat with PR Bot" }] },
    });
    expect((parkOptions.mock.calls[0]?.[1] as Array<{ option: { action: unknown } }>)[0]?.option.action).toEqual({ kind: "agent", slug: "pr-bot" });
  });

  it("lists matching agents in the order the agent ranked them, and a roster with the org's size", async () => {
    await deliverChannelAgentCards({ target, userId: "u1", orgId: "o", card: { variant: "profile-list", slugs: ["standup", "pr-bot", "gone"] } });
    const list = enqueueOutbound.mock.calls[0]?.[1] as { card: { header: string; sections: Array<{ rows: Array<{ title: string; description: string }> }> } };
    expect(list.card.header).toBe("2 agents that can help");
    expect(list.card.sections[0]!.rows.map((r) => [r.title, r.description])).toEqual([
      ["Standup", "/standup"],
      ["PR Bot", "Reviews pull requests"],
    ]);

    await deliverChannelAgentCards({ target, userId: "u1", orgId: "o", card: { variant: "summary" } });
    expect((enqueueOutbound.mock.calls[1]?.[1] as { card: { body: string } }).card.body).toContain("14 in your org");
  });

  it("sends nothing for a draft, or an agent that does not exist", async () => {
    expect(await deliverChannelAgentCards({ target, userId: "u1", orgId: "o", card: { variant: "draft" } })).toBe(false);
    expect(await deliverChannelAgentCards({ target, userId: "u1", orgId: "o", card: { variant: "profile", slug: "nope" } })).toBe(false);
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });
});

