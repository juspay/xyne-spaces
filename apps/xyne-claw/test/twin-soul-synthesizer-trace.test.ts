import { beforeEach, expect, test, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@xyne/litellm-client", () => ({
  fetchLiteLLMWithRetry: fetchMock,
}));

function okResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 123, completion_tokens: 9 },
    }),
    text: async () => "",
  };
}

beforeEach(() => {
  process.env["LITELLM_API_KEY"] = "test-key";
  delete process.env["TWIN_SYNTH_MAX_FACT_INPUT_CHARS"];
  fetchMock.mockReset();
});

test("captures the exact per-file LLM exchange and usage", async () => {
  fetchMock.mockResolvedValue(okResponse("# Soul\n\nYou reply briefly."));
  const { synthesizeMemoryFile } = await import("../src/twin-soul-synthesizer.js");

  const result = await synthesizeMemoryFile({
    fileName: "soul.md",
    description: "Core persona",
    facts: ["The user replies briefly."],
    maxChars: 10_000,
  });

  expect(result.content).toBe("# Soul\n\nYou reply briefly.");
  expect(result.trace).toMatchObject({
    rawOutput: "# Soul\n\nYou reply briefly.",
    factsAvailable: 1,
    factsUsed: 1,
    factsDropped: 0,
    factInputBudgetChars: 200_000,
    contextLimited: false,
    finishReason: "stop",
    usage: { promptTokens: 123, completionTokens: 9 },
  });
  expect(result.trace?.systemPrompt).toContain("You compile ONE persona file");
  expect(result.trace?.userPrompt).toContain("Approved facts about the user:");
  expect(result.trace?.userPrompt).toContain("The user replies briefly.");

  const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
  const sent = JSON.parse(init.body) as { messages: Array<{ role: string; content: string }>; max_tokens: number };
  expect(sent.messages).toEqual([
    { role: "system", content: result.trace?.systemPrompt },
    { role: "user", content: result.trace?.userPrompt },
  ]);
  expect(sent.max_tokens).toBeGreaterThan(0);
});

test("caps large memory sets and reports what was omitted", async () => {
  fetchMock.mockResolvedValue(okResponse("# Soul"));
  const { synthesizeMemoryFile } = await import("../src/twin-soul-synthesizer.js");
  const facts = Array.from({ length: 200 }, (_, i) => `fact-${i} ${"x".repeat(1_490)}`);

  const result = await synthesizeMemoryFile({
    fileName: "soul.md",
    description: "Core persona",
    facts,
    maxChars: 10_000,
  });

  expect(result.trace?.factsAvailable).toBe(200);
  expect(result.trace?.factsUsed).toBeLessThan(200);
  expect(result.trace?.factsDropped).toBe(200 - (result.trace?.factsUsed ?? 0));
  expect(result.trace?.factInputChars).toBeLessThanOrEqual(200_000);
  expect(result.trace?.factInputBudgetChars).toBe(200_000);
  expect(result.trace?.contextLimited).toBe(true);
});

test("passes an individual fact longer than 1,500 characters without clipping", async () => {
  fetchMock.mockResolvedValue(okResponse("# Soul"));
  const { synthesizeMemoryFile } = await import("../src/twin-soul-synthesizer.js");
  const longFact = `The user documented ${"x".repeat(2_000)}`;

  const result = await synthesizeMemoryFile({
    fileName: "soul.md",
    description: "Core persona",
    facts: [longFact],
    maxChars: 10_000,
  });

  expect(result.trace?.factsUsed).toBe(1);
  expect(result.trace?.factsClipped).toBe(0);
  expect(result.trace?.userPrompt).toContain(longFact);
  expect(result.trace?.contextLimited).toBe(false);
});
