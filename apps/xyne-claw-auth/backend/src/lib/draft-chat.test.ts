import { describe, expect, it } from "vitest";
import { buildDraftRunBody, DRAFT_TEST_RUN_NOTE, parseDraftSnapshot } from "./draft-chat.js";

describe("buildDraftRunBody", () => {
  it("maps an unsaved form onto an inline /run body", () => {
    const snapshot = parseDraftSnapshot({
      name: "Standup",
      description: "Writes the daily note",
      systemPrompt: "Be brief.",
      tools: {
        subagents: ["researcher"],
        direct: ["web_search"],
        custom: [],
        gateway: ["gmail"],
        callableAgents: ["helper"],
      },
      skillIds: ["skill-1"],
      kbScope: "COLLECTIONS",
      knowledgeBase: [{ collectionId: "col-1", fileId: null, name: "Docs" }],
    });
    expect(snapshot).not.toBeNull();

    const body = buildDraftRunBody({
      sessionId: "sess-1",
      sessionToken: "tok-1",
      userId: "user_1",
      message: "hello",
      draftConversationId: "conv-1",
      snapshot: snapshot!,
      skills: [{ name: "Notes", content: "Write notes." }],
    });

    expect(body["agentSlug"]).toBe("draft-user_1");
    expect(body["conversationId"]).toBe("conv-1");
    expect(body["task"]).toBe("hello");
    expect(body["systemPrompt"]).toContain("Be brief.");
    expect(body["systemPrompt"]).toContain("Standup");
    expect(body["spacesAppId"]).toBeUndefined();
    expect(body["spacesAppToken"]).toBeUndefined();

    const tools = (body["agentConfig"] as { tools: { gateway: string[]; direct: string[] } }).tools;
    expect(tools.gateway).toEqual([]);
    expect(tools.direct).toEqual(["web_search"]);
    expect(body["callableAgents"]).toEqual(["helper"]);
    expect(body["skills"]).toEqual([{ name: "Notes", content: "Write notes." }]);
    expect(String(body["additionalInstructions"])).toContain("gmail");
    expect(String(body["additionalInstructions"])).toContain("Docs");
  });

  it("carries the minted session and runs the draft read-only", () => {
    const snapshot = parseDraftSnapshot({ name: "Brief", systemPrompt: "Be brief." });
    const body = buildDraftRunBody({
      sessionId: "sess-2",
      sessionToken: "tok-2",
      userId: "user_2",
      message: "hi",
      draftConversationId: "conv-2",
      snapshot: snapshot!,
    });

    // claw /run rejects a run whose token is missing or whose sid differs.
    expect(body["sessionId"]).toBe("sess-2");
    expect(body["sessionToken"]).toBe("tok-2");
    expect(body["idempotencyKey"]).toBe("sess-2");
    expect((body["agentConfig"] as { permissionMode: string }).permissionMode).toBe("read-only");
    expect(String(body["additionalInstructions"])).toContain(DRAFT_TEST_RUN_NOTE);
  });
});
