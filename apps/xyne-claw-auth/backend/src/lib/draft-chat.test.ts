import { describe, expect, it } from "vitest";
import {
  buildDraftRunBody,
  DRAFT_ATTACHMENT_MAX_COUNT,
  DRAFT_TEST_RUN_NOTE,
  parseDraftAttachments,
  parseDraftSnapshot,
} from "./draft-chat.js";

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

  it("turns the composer switches into tools for this message and forwards files", () => {
    const snapshot = parseDraftSnapshot({
      name: "Scout",
      systemPrompt: "Find things.",
      tools: { custom: ["web-search", "summary"] },
    });
    const files = [{ fileName: "notes.txt", mimeType: "text/plain", data: "aGk=" }];
    const body = buildDraftRunBody({
      sessionId: "sess-3",
      sessionToken: "tok-3",
      userId: "user_3",
      message: "what changed?",
      draftConversationId: "conv-3",
      snapshot: snapshot!,
      attachments: files,
      webSearch: true,
      deepResearch: true,
    });

    const tools = (body["agentConfig"] as { tools: { custom: string[] } }).tools;
    expect(tools.custom).toEqual(["web-search", "summary", "deep-research"]);
    expect(body["attachments"]).toEqual(files);
    expect(String(body["additionalInstructions"])).toContain("web search");
    expect(String(body["additionalInstructions"])).toContain("deep research");
  });

  it("leaves tools, notes and files alone when the switches are off", () => {
    const snapshot = parseDraftSnapshot({ name: "Brief", tools: { custom: ["summary"] } });
    const body = buildDraftRunBody({
      sessionId: "sess-4",
      sessionToken: "tok-4",
      userId: "user_4",
      message: "hi",
      draftConversationId: "conv-4",
      snapshot: snapshot!,
      attachments: [],
    });

    expect((body["agentConfig"] as { tools: { custom: string[] } }).tools.custom).toEqual(["summary"]);
    expect(body["attachments"]).toBeUndefined();
    expect(String(body["additionalInstructions"])).not.toContain("web search");
  });
});

describe("parseDraftAttachments", () => {
  it("treats a missing list as no files", () => {
    expect(parseDraftAttachments(undefined)).toEqual([]);
  });

  it("keeps well-formed base64 files", () => {
    expect(
      parseDraftAttachments([{ fileName: " a.txt ", mimeType: "text/plain", data: "aGk=" }]),
    ).toEqual([{ fileName: "a.txt", mimeType: "text/plain", data: "aGk=" }]);
  });

  it("refuses malformed entries, data URLs and lists over the cap", () => {
    expect(parseDraftAttachments("nope")).toBeNull();
    expect(parseDraftAttachments([{ fileName: "a.txt", mimeType: "text/plain" }])).toBeNull();
    expect(
      parseDraftAttachments([
        { fileName: "a.txt", mimeType: "text/plain", data: "data:text/plain;base64,aGk=" },
      ]),
    ).toBeNull();
    const one = { fileName: "a.txt", mimeType: "text/plain", data: "aGk=" };
    expect(parseDraftAttachments(Array(DRAFT_ATTACHMENT_MAX_COUNT + 1).fill(one))).toBeNull();
  });

  it("refuses files that add up to more than 25MB", () => {
    const big = "A".repeat(Math.ceil((13 * 1024 * 1024) / 3) * 4);
    const file = { fileName: "big.bin", mimeType: "application/octet-stream", data: big };
    expect(parseDraftAttachments([file])).toHaveLength(1);
    expect(parseDraftAttachments([file, file])).toBeNull();
  });
});
