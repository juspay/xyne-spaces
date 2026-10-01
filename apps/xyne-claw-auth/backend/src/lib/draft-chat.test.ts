import { describe, expect, it } from "vitest";
import {
  buildDraftRunBody,
  CAPABILITY_GAP_TOOL,
  describeDraftCapabilities,
  DRAFT_ATTACHMENT_MAX_COUNT,
  DRAFT_BLANK_PERSONA,
  DRAFT_TEST_RUN_NOTE,
  currentTimeNote,
  parseDraftAttachments,
  parseDraftSnapshot,
  type DraftCapabilityCatalog,
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

describe("currentTimeNote", () => {
  const now = new Date("2026-10-01T05:12:00Z");

  it("gives the date and time in the user's zone", () => {
    expect(currentTimeNote("Asia/Kolkata", now)).toBe(
      "For the user it is Thursday, 1 October 2026 at 10:42 (Asia/Kolkata).",
    );
  });

  it("falls back to UTC for a missing or unknown zone", () => {
    expect(currentTimeNote(undefined, now)).toContain("05:12 (UTC)");
    expect(currentTimeNote("Mars/Olympus", now)).toContain("(UTC)");
  });
});

describe("blank drafts", () => {
  it("never sends an empty persona, which claw would turn into the Digital Twin", () => {
    const body = buildDraftRunBody({
      sessionId: "sess-5",
      sessionToken: "tok-5",
      userId: "user_5",
      message: "hi",
      draftConversationId: "conv-5",
      snapshot: parseDraftSnapshot({ tools: { subagents: ["spaces"] } })!,
    });
    expect(body["systemPrompt"]).toBe(DRAFT_BLANK_PERSONA);
    expect((body["agentConfig"] as Record<string, unknown>)["draftTestRun"]).toBe(true);
  });
});

describe("describeDraftCapabilities", () => {
  const catalog: DraftCapabilityCatalog = {
    integrations: [
      {
        slug: "linear",
        label: "Linear",
        kind: "mcp",
        readTools: [{ slug: "linear-list", name: "list_issues" }],
        writeTools: [{ slug: "linear-create", name: "create_issue" }],
      },
      {
        slug: "gateway:github:gh-1",
        label: "Github (gh-1)",
        kind: "gateway",
        readTools: [{ slug: "gateway:github:gh-1:list_prs", name: "list_prs" }],
        writeTools: [],
      },
      { slug: "slack", label: "Slack", kind: "mcp", readTools: [{ slug: "slack-read", name: "read_channel" }], writeTools: [] },
      { slug: "builtin", label: "Sandbox", kind: "builtin", readTools: [], writeTools: [] },
    ],
    subagents: [
      { name: "spaces", description: "Searches Spaces messages and tickets" },
      { name: "bitbucket", description: "Reads pull requests" },
    ],
    skillNames: ["PRD writer", "Notes"],
  };

  it("sorts what the draft has by whether a test can use it", () => {
    const snapshot = parseDraftSnapshot({
      systemPrompt: "Triage issues.",
      tools: {
        direct: ["list_issues", "create_issue"],
        gateway: ["github"],
        subagents: ["spaces"],
      },
      knowledgeBase: [{ collectionId: "col-1", name: "Runbooks" }],
    })!;
    const text = describeDraftCapabilities({ snapshot, custom: [], skillNames: ["Notes"], catalog });

    const section = (heading: string): string => text.split(heading)[1]?.split(/\n[A-Z]/)[0] ?? "";
    expect(section("Works in this test:")).toContain("Linear (list_issues)");
    expect(section("Works in this test:")).toContain("spaces subagent: Searches Spaces");
    expect(section("Works in this test:")).toContain("Skill: Notes");
    expect(section("only connects after the agent is saved:")).toContain("Github (gh-1)");
    expect(section("only connects after the agent is saved:")).toContain("Knowledge: Runbooks");
    expect(section("read-only in this test")).toContain("Linear (create_issue)");

    const addable = section("never recite this list):");
    expect(addable).toContain("Integrations: Slack");
    expect(addable).not.toContain("Linear");
    expect(addable).not.toContain("Sandbox");
    expect(addable).toContain("Subagents: bitbucket");
    expect(addable).toContain("Skills: PRD writer");
    expect(text).toContain(CAPABILITY_GAP_TOOL);
  });

  it("keeps tools whose account isn't connected out of what works", () => {
    const snapshot = parseDraftSnapshot({
      systemPrompt: "Review PRs.",
      tools: { direct: ["list_issues", "create_issue"], subagents: ["bitbucket", "spaces"] },
    })!;
    const text = describeDraftCapabilities({
      snapshot,
      custom: [],
      skillNames: [],
      catalog: {
        ...catalog,
        subagents: [
          { name: "spaces", description: "Searches Spaces", serverType: "spaces" },
          { name: "bitbucket", description: "Reads pull requests", serverType: "bitbucket" },
        ],
        connections: { serverTypes: ["linear", "bitbucket", "spaces"], connected: ["spaces"] },
      },
    });

    const section = (heading: string): string => text.split(heading)[1]?.split(/\n[A-Z]/)[0] ?? "";
    const unconnected = section("hasn't connected the account it needs");
    expect(unconnected).toContain("- Linear");
    expect(unconnected).toContain("- bitbucket subagent");
    expect(section("Works in this test:")).toContain("spaces subagent");
    expect(section("Works in this test:")).not.toContain("Linear");
    // An unconnected server's writes aren't "read-only in this test"; they don't load at all.
    expect(text).not.toContain("read-only in this test");
    expect(text).toContain('"not_connected"');
  });

  it("counts Spaces as connected: runs reach it with the user's sign-in", () => {
    const text = describeDraftCapabilities({
      snapshot: parseDraftSnapshot({ systemPrompt: "x", tools: { subagents: ["spaces"] } })!,
      custom: [],
      skillNames: [],
      catalog: {
        ...catalog,
        subagents: [{ name: "spaces", description: "Searches Spaces", serverType: "xyne-spaces" }],
        connections: { serverTypes: ["xyne-spaces"], connected: [] },
      },
    });
    expect(text).not.toContain("hasn't connected");
    expect(text.split("Works in this test:")[1]).toContain("spaces subagent");
  });

  it("falls back to raw ids when the catalog is unavailable", () => {
    const snapshot = parseDraftSnapshot({ systemPrompt: "x", tools: { direct: ["mystery_tool"], gateway: ["gmail"] } })!;
    const text = describeDraftCapabilities({ snapshot, custom: [], skillNames: [], catalog: null });
    expect(text).toContain("Tools: mystery_tool");
    expect(text).toContain("- gmail");
    expect(text).not.toContain("can be added");
  });

  it("says when nothing is wired in yet", () => {
    const text = describeDraftCapabilities({
      snapshot: parseDraftSnapshot({ systemPrompt: "Be brief." })!,
      custom: [],
      skillNames: [],
    });
    expect(text).toContain("Nothing beyond its instructions.");
  });
});
