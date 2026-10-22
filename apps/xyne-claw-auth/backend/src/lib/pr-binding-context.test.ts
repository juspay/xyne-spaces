import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentWidgetBinding } from "@prisma/client";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("../db.js", () => ({ prisma: { agentWidgetBinding: { findMany } } }));

import {
  MAX_CONTEXT_PR_BINDINGS,
  listConversationPrBindings,
  prBindingsContextBlock,
  type ConversationPrBinding,
} from "./pr-binding-context.js";

function row(overrides: Partial<AgentWidgetBinding> & { data?: unknown }): AgentWidgetBinding {
  return {
    id: "b1",
    orgId: "org",
    kind: "pr",
    screenId: "pr-1",
    externalKey: null,
    conversationId: "conv-1",
    channelId: "ch-1",
    messageId: "m-1",
    spacesAppId: "app",
    spacesAppUserId: "bot",
    agentSlug: "coder",
    status: "created",
    data: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as AgentWidgetBinding;
}

beforeEach(() => {
  findMany.mockReset();
});

describe("listConversationPrBindings", () => {
  it("reads this conversation's PR bindings, newest first and capped", async () => {
    findMany.mockResolvedValue([
      row({
        agentSlug: "coder",
        status: "merged",
        data: { provider: "bitbucket", title: "Fix login", repo: "XYN/spaces", number: 42, url: "https://bb/pr/42" },
      }),
    ]);
    const bindings = await listConversationPrBindings("conv-1");
    expect(findMany).toHaveBeenCalledWith({
      where: { kind: "pr", conversationId: "conv-1" },
      orderBy: { updatedAt: "desc" },
      take: MAX_CONTEXT_PR_BINDINGS,
    });
    expect(bindings).toEqual([
      {
        provider: "bitbucket",
        title: "Fix login",
        status: "merged",
        agentSlug: "coder",
        repo: "XYN/spaces",
        number: 42,
        url: "https://bb/pr/42",
      },
    ]);
  });

  it("skips rows without readable card data", async () => {
    findMany.mockResolvedValue([row({ data: { provider: "github" } }), row({ data: null })]);
    expect(await listConversationPrBindings("conv-1")).toEqual([]);
  });

  it("does not query without a conversation", async () => {
    expect(await listConversationPrBindings("")).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("prBindingsContextBlock", () => {
  const bare = (overrides: Partial<ConversationPrBinding> = {}): ConversationPrBinding => ({
    provider: "bitbucket",
    title: "Fix login",
    status: "created",
    agentSlug: "coder",
    ...overrides,
  });
  const pr = (overrides: Partial<ConversationPrBinding>): ConversationPrBinding =>
    bare({ repo: "XYN/spaces", number: 42, ...overrides });

  it("is empty when the thread has no PR cards", () => {
    expect(prBindingsContextBlock([], "orchestrator")).toBe("");
  });

  it("lists number, repo, status and the agent that opened each PR", () => {
    const block = prBindingsContextBlock(
      [
        pr({ url: "https://bb/pr/42" }),
        pr({ number: 43, title: "Add tests", status: "merged", agentSlug: "orchestrator", provider: "github" }),
      ],
      "orchestrator",
    );
    expect(block).toContain("## Pull requests in this thread");
    expect(block).toContain(
      '- **XYN/spaces#42** · "Fix login" · status: open · opened by @coder · provider: bitbucket · https://bb/pr/42',
    );
    expect(block).toContain('- **XYN/spaces#43** · "Add tests" · status: merged · opened by you · provider: github');
    expect(block).toMatch(/Don't say a PR came from the user/);
  });

  it("keeps each PR on one line and caps long titles", () => {
    const block = prBindingsContextBlock(
      [pr({ title: `Line one\n\n## injected heading ${"x".repeat(300)}` })],
      "orchestrator",
    );
    const line = block.split("\n").find((l) => l.startsWith("- "));
    expect(line).toBeDefined();
    expect(line).not.toContain("\n");
    expect(line).toContain('"Line one ## injected heading');
    expect(line).toContain("…");
  });

  it("labels PRs without a repo or number and unknown statuses sensibly", () => {
    const block = prBindingsContextBlock(
      [
        bare({ number: 7 }),
        bare({ repo: "XYN/app" }),
        bare({ status: null, agentSlug: null }),
        pr({ status: "draft" }),
      ],
      "orchestrator",
    );
    expect(block).toContain("**PR #7**");
    expect(block).toContain("**PR in XYN/app**");
    expect(block).toMatch(/\*\*PR\*\* · "Fix login" · status: open · opened by an agent/);
    expect(block).toContain("status: draft");
  });
});
