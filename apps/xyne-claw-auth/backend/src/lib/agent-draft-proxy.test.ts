import { describe, expect, it } from "vitest";
import {
  cronIntervalProblem,
  frameSse,
  freeHandle,
  parseAgentDraftRequest,
  planFromCapabilities,
  readSseMessages,
} from "./agent-draft-proxy.js";

const catalog = {
  subagents: [{ name: "spaces", description: "Reads Spaces" }],
  integrations: [
    {
      slug: "github",
      label: "GitHub",
      readTools: [{ name: "list_prs", description: "List PRs", riskLevel: "read" }],
      writeTools: [{ name: "create_comment", description: "Comment", riskLevel: "write" }],
    },
    {
      slug: "slack",
      label: "Slack",
      readTools: [{ name: "read_channel", description: "Read", riskLevel: "read" }],
      writeTools: [{ name: "post_message", description: "Post", riskLevel: "write" }],
    },
  ],
};

describe("agent-draft-proxy", () => {
  it("validates the dashboard request and defaults what is optional", () => {
    expect(parseAgentDraftRequest(null)).toBe("body is required");
    expect(parseAgentDraftRequest({ draftId: "d", turnId: "t", message: " ", canvas: {} })).toBe("message is required");
    const ok = parseAgentDraftRequest({
      draftId: "d",
      turnId: "t",
      message: "Post a PR digest to Slack",
      canvas: { name: "Digest" },
      timezone: "Not/AZone",
      userOwned: ["name", "bogus"],
    });
    expect(ok).toMatchObject({
      timezone: "UTC",
      userOwned: ["name"],
      history: [],
      canvas: { name: "Digest", handle: "", schedule: null, capabilities: [], permissionMode: "ask-first" },
    });
  });

  it("keeps the last 12 turns of history, each trimmed", () => {
    const history = Array.from({ length: 20 }, (_v, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `turn ${i} ${"x".repeat(3_000)}`,
    }));
    const ok = parseAgentDraftRequest({ draftId: "d", turnId: "t", message: "hi", canvas: {}, history });
    if (typeof ok === "string") throw new Error(ok);
    expect(ok.history).toHaveLength(12);
    expect(ok.history[0]!.text.startsWith("turn 8 ")).toBe(true);
    expect(ok.history.every((turn) => turn.text.length <= 2_000)).toBe(true);
  });

  it("carries the chat's activity, suggestion and question frames through intact", () => {
    const question = {
      seq: 3,
      turnId: "t",
      id: "t-q",
      questions: [{ id: "q1", label: "Job", question: "What should it do?", type: "single_choice", options: [{ label: "Review PRs" }, { label: "Digest" }] }],
    };
    const wire =
      frameSse("activity", { seq: 1, turnId: "t", id: "search-1", kind: "search", status: "running", label: "Searching the web: x" }) +
      frameSse("suggestion", { seq: 2, turnId: "t", suggestions: [{ id: "s1", label: "Add PR reviews", message: "Add a PR review step." }] }) +
      frameSse("question", question);
    const { messages, rest } = readSseMessages(wire);
    expect(rest).toBe("");
    expect(messages.map((m) => m.event)).toEqual(["activity", "suggestion", "question"]);
    expect(messages[2]!.data).toEqual(question);
  });

  it("turns engine picks into the suggest-tools shape, granting writes only where asked", () => {
    const plan = planFromCapabilities(
      {
        bound: [
          { hub: "mcp", id: "slack", label: "Slack", confidence: 0.9, reason: "posts", access: "write" },
          { hub: "subagent", id: "spaces", label: "spaces", confidence: 1, reason: "named" },
        ],
        suggested: [{ hub: "mcp", id: "github", label: "GitHub", confidence: 0.6, reason: "PRs", access: "read" }],
      },
      { intent: "post the PR digest to slack", catalog, knowledge: [] },
    );
    expect(plan.source).toBe("xor");
    expect(plan.subagents).toEqual(["spaces"]);
    expect(plan.integrations).toEqual([
      { slug: "slack", readTools: ["read_channel"], writeTools: ["post_message"] },
    ]);
    expect(plan.suggested.integrations).toMatchObject([
      { slug: "github", label: "GitHub", confidence: 0.6, readTools: ["list_prs"], writeTools: [] },
    ]);
  });

  it("reads complete SSE messages, keeps the unfinished tail, drops keepalives", () => {
    const first = frameSse("identity", { seq: 1, turnId: "t", name: "Digest" });
    const { messages, rest } = readSseMessages(`: keepalive\n\n${first}event: ack\ndata: {"seq":2`);
    expect(messages).toEqual([{ event: "identity", data: { seq: 1, turnId: "t", name: "Digest" } }]);
    expect(rest).toBe('event: ack\ndata: {"seq":2');
  });

  it("suffixes a taken handle", async () => {
    const taken = new Set(["digest", "digest-2"]);
    expect(await freeHandle("digest", async (h) => taken.has(h))).toBe("digest-3");
    expect(await freeHandle("fresh", async (h) => taken.has(h))).toBe("fresh");
  });

  it("flags crons that fire more often than the minimum interval", () => {
    expect(cronIntervalProblem("*/5 * * * *", 30)).toMatch(/every 30 minutes/);
    expect(cronIntervalProblem("* * * * *", 30)).toMatch(/every 30 minutes/);
    expect(cronIntervalProblem("0 9 * * 1-5", 30)).toBeNull();
    expect(cronIntervalProblem("*/5 * * * *", 0)).toBeNull();
  });
});
