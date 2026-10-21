import { test, expect, vi, beforeEach } from "vitest";

// Mock only the provider; keep bankIdForAgent real (isDigitalTwinAgent needs it).
const recallMock = vi.fn();
vi.mock("xyne-claw-shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("xyne-claw-shared")>()),
  getMemoryProvider: () => ({ recall: recallMock }),
}));

beforeEach(() => {
  process.env["HINDSIGHT_URL"] = "http://test-hindsight"; // makes HINDSIGHT.enabled true
  recallMock.mockReset();
});

async function runRecall(agentSlug: string, userId: string, query = "x") {
  const { buildMemorySearchTool } = await import("../src/memory-search.js");
  // sessionId="" → skips the fire-and-forget recall-hit POST.
  const tool = buildMemorySearchTool(agentSlug, userId, "");
  const res = (await tool.execute("tc", { query })) as { content: Array<{ text: string }> };
  return res.content[0]!.text;
}

test("digital-twin recall is hard-filtered to the requester's own user tag", async () => {
  // Provider over-matches and returns another user's memory too (the incident).
  recallMock.mockResolvedValue([
    { id: "1", text: "MINE-secret", tags: ["user:u1"] },
    { id: "2", text: "THEIRS-private", tags: ["user:u2"] },
  ]);
  const text = await runRecall("digital-twin", "u1");
  expect(text).toContain("MINE-secret");
  expect(text).not.toContain("THEIRS-private"); // cross-user leak prevented
});

test("digital-twin recall with ONLY foreign results returns nothing", async () => {
  recallMock.mockResolvedValue([{ id: "2", text: "THEIRS", tags: ["user:u2"] }]);
  const text = await runRecall("digital-twin", "u1");
  expect(text).toMatch(/No memories matched/i);
  expect(text).not.toContain("THEIRS");
});

test("non-twin (shared) recall is NOT user-filtered (provider-trusted)", async () => {
  // Distinct sentences: dedupeSimilar collapses near-identical token sets.
  recallMock.mockResolvedValue([
    { id: "1", text: "deploys go through Argo", tags: ["shared"] },
    { id: "2", text: "redis cache ttl is sixty seconds", tags: ["subsystem:spaces"] },
  ]);
  const text = await runRecall("assistant", "u1");
  expect(text).toContain("deploys go through Argo");
  expect(text).toContain("redis cache ttl is sixty seconds");
});

test("memory disabled → returns 'not configured' without calling the provider", async () => {
  delete process.env["HINDSIGHT_URL"];
  delete process.env["MEMORY_PROVIDER"]; // both gates must be off (config.ts ORs them)
  vi.resetModules(); // re-evaluate config with HINDSIGHT_URL unset
  const text = await runRecall("digital-twin", "u1");
  expect(text).toMatch(/not configured/i);
  expect(recallMock).not.toHaveBeenCalled();
});
