import { beforeEach, describe, expect, it, vi } from "vitest";

const interact = vi.fn();
vi.mock("../mcp/servers/xyne-spaces-client.js", () => ({
  interact: (...args: unknown[]) => interact(...args),
  spacesFetch: vi.fn(),
  spacesFetchText: vi.fn(),
  spacesFetchBuffer: vi.fn(),
}));

const { buildAttachedContextPayload, normalizeAttachedContext } = await import(
  "./agentChatContextService.js"
);

describe("context picked from the composer's @ menu", () => {
  beforeEach(() => interact.mockReset());

  it("accepts messages, people and shared files", () => {
    const { items, error } = normalizeAttachedContext([
      { type: "message", id: "m1", title: "Prakhar: Hey, what…", threadId: "c1" },
      { type: "user", id: "u1", title: "Samit Barai" },
      { type: "attachment", id: "a1", title: "recording.png", threadId: "c2" },
    ]);
    expect(error).toBeUndefined();
    expect(items.map(item => item.type)).toEqual(["message", "user", "attachment"]);
  });

  it("inlines a picked message's text so the agent needs no lookup", async () => {
    interact.mockResolvedValueOnce([
      { messageId: "m1", conversationId: "c1", senderId: "u9", content: "Barclays wants the demo moved", createdAt: "2026-10-07T10:00:00Z" },
    ]);
    const res = await buildAttachedContextPayload([{ type: "message", id: "m1", title: "Prakhar: Barclays…", threadId: "c1" }]);
    expect(res.promptPrefix).toContain('Message "Prakhar: Barclays…" (id=m1)');
    expect(res.promptPrefix).toContain("Barclays wants the demo moved");
    expect(res.promptPrefix).toContain("spaces-message-detail");
  });

  it("names the person behind an @mention and the shared file's fetch tool", async () => {
    const res = await buildAttachedContextPayload([
      { type: "user", id: "u1", title: "Samit Barai" },
      { type: "attachment", id: "a1", title: "deck.pdf", threadId: "c2" },
    ]);
    expect(res.promptPrefix).toContain('"@Samit Barai" in the query means this person');
    expect(res.promptPrefix).toContain("spaces-fetch-attachment` (attachmentId=a1)");
    expect(interact).not.toHaveBeenCalled();
  });
});

describe("framing: project knowledge versus the user's own turn", () => {
  beforeEach(() => interact.mockReset());

  const items = [{ type: "channel" as const, id: "chan-1", title: "#design" }];

  it("does not claim the user attached a project's items to their message", async () => {
    const res = await buildAttachedContextPayload(items, undefined, {
      framing: "project-knowledge",
    });
    expect(res.promptPrefix).toContain("# Project context");
    expect(res.promptPrefix).toContain("attached to this chat's project");
    expect(res.promptPrefix).not.toContain("I have attached the following item(s) with my message");
  });

  it("drops the demand to ground every answer in all of them", async () => {
    const res = await buildAttachedContextPayload(items, undefined, {
      framing: "project-knowledge",
    });
    expect(res.promptPrefix).not.toContain("ground your answer in all of them");
    expect(res.promptPrefix).toContain("Do NOT fetch the ones my question does not touch");
  });

  it("still tells the agent how to fetch an item that does bear on the question", async () => {
    const res = await buildAttachedContextPayload(items, undefined, {
      framing: "project-knowledge",
    });
    expect(res.promptPrefix).toContain("spaces-");
    expect(res.promptPrefix).toContain('Channel "#design" (id=chan-1)');
  });

  it("renders the user's own turn exactly as it did without the option", async () => {
    const withoutOption = await buildAttachedContextPayload(items);
    const explicitDefault = await buildAttachedContextPayload(items, undefined, {
      framing: "user-attached",
    });
    expect(withoutOption.promptPrefix).toBe(explicitDefault.promptPrefix);
    expect(withoutOption.promptPrefix).toContain(
      "I have attached the following item(s) with my message",
    );
    expect(withoutOption.promptPrefix).toContain("ground your answer in all of them");
  });

  it("keeps the citation and don't-guess rules in the project block too", async () => {
    const res = await buildAttachedContextPayload(items, undefined, {
      framing: "project-knowledge",
    });
    expect(res.promptPrefix).toContain("Never state unverified information");
    expect(res.promptPrefix).toContain("ask me before assuming");
  });
});
