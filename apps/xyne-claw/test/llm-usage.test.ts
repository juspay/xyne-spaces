import { describe, it, expect, beforeEach, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import {
  billingFor,
  flushLlmUsage,
  pendingLlmUsage,
  PI_SUMMARIZER_PROMPT_START,
  recordChatCompletion,
  recordPiCall,
  setLlmUsageSender,
  toolNamesSinceLastReply,
  usageScopeMiddleware,
  withUsageScope,
  type LlmCallEvent,
} from "../src/llm-usage.js";
import { executeRunFromPayload } from "../src/run-execution.js";

vi.mock("../src/routes/run.js", () => ({
  ensureActiveRun: () => ({ abortController: new AbortController() }),
  finishActiveRun: () => {},
  normalizeExperimentContext: (x: unknown) => x,
  processTask: async () => recordChatCompletion("video", "open-large", { usage: { prompt_tokens: 10, completion_tokens: 2 } }),
}));

const model = (provider: string, id = "m1") => ({ provider, id, api: "openai-completions" }) as unknown as Model<Api>;
const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) =>
  ({ input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const reply = (over: Partial<AssistantMessage>): AssistantMessage =>
  ({ role: "assistant", content: [], api: "openai-completions", provider: "litellm", model: "m1", usage: usage(0, 0), stopReason: "stop", timestamp: 0, ...over }) as AssistantMessage;

async function drain(): Promise<LlmCallEvent[]> {
  const sent: LlmCallEvent[] = [];
  setLlmUsageSender(async (events) => void sent.push(...events));
  await flushLlmUsage(1000);
  setLlmUsageSender(null);
  return sent;
}

beforeEach(async () => {
  await drain();
});

describe("billingFor", () => {
  it.each([
    ["litellm", false, "spaces", "platform"],
    ["litellm-user", false, "litellm", "api_key"],
    ["anthropic-user", false, "claude", "api_key"],
    ["anthropic-user", true, "claude", "subscription"],
    ["openai-user", false, "codex", "api_key"],
    ["openai-codex-user", false, "codex", "subscription"],
    ["copilot-user", false, "copilot", "subscription"],
  ])("%s (oauth=%s) → %s/%s", (pi, oauth, provider, billing) => {
    expect(billingFor(pi, oauth)).toEqual({ provider, billing });
  });
});

describe("recordPiCall", () => {
  it("records the provider's usage with run scope and the tools the call read", async () => {
    const context = {
      messages: [
        { role: "assistant", content: [] },
        { role: "toolResult", toolName: "search", toolCallId: "a", content: [], isError: false, timestamp: 0 },
        { role: "toolResult", toolName: "fetch", toolCallId: "b", content: [], isError: false, timestamp: 0 },
      ],
    } as unknown as Context;
    withUsageScope({ runId: "run-1", userId: "u1", agentSlug: "bot" }, () =>
      withUsageScope({ conversationId: "c1" }, () =>
        recordPiCall({ model: model("litellm"), context, result: reply({ usage: usage(120, 30, 900, 50), responseModel: "glm-5", responseId: "r1" }), startedAt: Date.now() - 5, labels: { purpose: "subagent", subagent: "researcher" } }),
      ),
    );
    const [e] = await drain();
    expect(e).toMatchObject({
      runId: "run-1", userId: "u1", agentSlug: "bot", conversationId: "c1", purpose: "subagent", subagent: "researcher",
      provider: "spaces", billing: "platform", model: "m1", servedModel: "glm-5", responseId: "r1", outcome: "ok",
      usageReported: true, input: 120, output: 30, cacheRead: 900, cacheWrite: 50, toolNames: ["search", "fetch"],
    });
  });

  it.each([
    ["error with partial usage", reply({ stopReason: "error", usage: usage(500, 0) }), "error", true],
    ["aborted before usage", reply({ stopReason: "aborted" }), "aborted", false],
    ["no final message", undefined, "error", false],
  ])("%s", async (_label, result, outcome, reported) => {
    recordPiCall({ model: model("anthropic-user"), result, startedAt: Date.now(), labels: { claudeOauth: true } });
    const [e] = await drain();
    expect(e).toMatchObject({ outcome, usageReported: reported, provider: "claude", billing: "subscription" });
  });
});

describe("recordPiCall compaction label", () => {
  it("tags pi's built-in compaction, which runs through the agent's own streamFn", async () => {
    const piPrompts = readFileSync(join(__dirname, "../node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/utils.js"), "utf8");
    expect(piPrompts).toContain(`SUMMARIZATION_SYSTEM_PROMPT = \`${PI_SUMMARIZER_PROMPT_START}`);
    const context = { systemPrompt: `${PI_SUMMARIZER_PROMPT_START} Summarize.`, messages: [] } as unknown as Context;
    recordPiCall({ model: model("litellm"), context, result: reply({ usage: usage(10, 5) }), startedAt: Date.now(), labels: { purpose: "main" } });
    const [e] = await drain();
    expect(e).toMatchObject({ purpose: "compaction" });
  });
});

describe("usage scope sources", () => {
  const scopeOf = (headers: Record<string, string>, body: unknown): Promise<LlmCallEvent | undefined> => {
    usageScopeMiddleware({ headers, body }, null, () => recordChatCompletion("prompt_tools", "m", {}));
    return drain().then((events) => events[0]);
  };

  it("ignores body ids once claw-auth sends usage headers", async () => {
    const e = await scopeOf({ "x-usage-user-id": "me" }, { sessionId: "someone-elses-run", orgId: "other-org", agentSlug: "x" });
    expect(e).toMatchObject({ userId: "me" });
    expect(e).not.toHaveProperty("runId");
    expect(e).not.toHaveProperty("orgId");
  });

  it("falls back to body ids when there are no usage headers", async () => {
    expect(await scopeOf({}, { sessionId: "run-9", userId: "u9" })).toMatchObject({ runId: "run-9", userId: "u9" });
  });

  it("scopes a queued run's side calls before runTask starts", async () => {
    await executeRunFromPayload({ sessionId: "run-q", sessionToken: "t", userId: "u-q", agentSlug: "bot", conversationId: "c-q", ticketIds: ["T-1"] });
    const [e] = await drain();
    expect(e).toMatchObject({ runId: "run-q", userId: "u-q", agentSlug: "bot", conversationId: "c-q", ticketId: "T-1", purpose: "video" });
  });
});

describe("recordChatCompletion", () => {
  it("splits cached prompt tokens out of input like pi-ai's openai parser", async () => {
    withUsageScope({ runId: "run-2" }, () =>
      recordChatCompletion("title", "open-fast", { id: "chatcmpl-1", model: "glm-5", usage: { prompt_tokens: 1000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 600 } } }),
    );
    recordChatCompletion("eval", "gpt-x", { usage: {} }, { provider: "copilot", billing: "subscription" });
    const [title, evalCall] = await drain();
    expect(title).toMatchObject({ runId: "run-2", purpose: "title", model: "open-fast", servedModel: "glm-5", input: 400, cacheRead: 600, output: 40, usageReported: true });
    expect(evalCall).toMatchObject({ provider: "copilot", billing: "subscription", usageReported: false, input: 0 });
  });
});

describe("delivery", () => {
  it("keeps calls queued across a failed report and sends each once", async () => {
    recordChatCompletion("judge", "m", { usage: { prompt_tokens: 1, completion_tokens: 1 } });
    let attempts = 0;
    const sent: LlmCallEvent[] = [];
    setLlmUsageSender(async (events) => {
      if (++attempts === 1) throw new Error("down");
      sent.push(...events);
    });
    await flushLlmUsage(5000);
    setLlmUsageSender(null);
    expect(attempts).toBe(2);
    expect(sent).toHaveLength(1);
    expect(pendingLlmUsage()).toHaveLength(0);
  });
});

describe("toolNamesSinceLastReply", () => {
  it("returns nothing for a fresh prompt", () => {
    expect(toolNamesSinceLastReply({ messages: [{ role: "user", content: "hi", timestamp: 0 }] } as unknown as Context)).toEqual([]);
  });
});

describe("side-call coverage guard", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
    });
  const root = join(__dirname, "../src");
  const shared = join(__dirname, "../../../packages/xyne-claw-shared/src");
  it("every module that calls an LLM endpoint records its usage", () => {
    const missing = [...files(root), ...files(shared)].filter((p) => {
      if (p.endsWith("litellm-chat.ts") || p.endsWith("llm-usage.ts")) return false;
      // Unregistered since 2026-09-26 (see registry.ts); record their calls before registering them again.
      if (/tools\/create-(ppt|pdf)\/tools\.ts$/.test(p)) return false;
      const code = readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
      const calls = /((chat\/completions|v1\/decisions)["'`]|postChatCompletion\()/.test(code) && /(fetch|fetchLiteLLMWithRetry|postChatCompletion|httpsPost)\(/.test(code);
      return calls && !code.includes("recordChatCompletion(");
    });
    expect(missing.map((p) => p.slice(join(root, "../..").length + 1))).toEqual([]);
  });
});
