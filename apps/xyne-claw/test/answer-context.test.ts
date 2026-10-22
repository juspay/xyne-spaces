import { test, expect } from "vitest";

// Read once at module load, so set before importing.
process.env["XYNE_CLAW_ANSWER_RETRIEVE_TIMEOUT_MS"] = "200";
const { buildAnswerContext } = await import("../src/answer-context.js");

const tool = (name: string, ms: number, text: string) => ({
  name,
  execute: () =>
    new Promise((resolve) => setTimeout(() => resolve({ content: [{ type: "text", text }] }), ms)),
});

test("a slow source past the deadline keeps the fast sources' results", async () => {
  const started = Date.now();
  const { block, sections } = await buildAnswerContext({
    query: "who owns billing",
    scope: "all",
    tools: [
      tool("Xyne_Spaces__spaces-vespa-search", 10, "billing is owned by Asha"),
      tool("kb-search", 1_000, "kb chunk"),
    ],
  });
  expect(Date.now() - started).toBeLessThan(600);
  expect(sections.map((s) => s.heading)).toEqual([
    "Search: message",
    "Search: ticket",
    "Search: attachment",
    "Search: mail",
  ]);
  expect(block).toContain("billing is owned by Asha");
  expect(block).not.toContain("kb chunk");
});

test("all sources inside the deadline return without waiting for it", async () => {
  const started = Date.now();
  const { sections } = await buildAnswerContext({
    query: "q",
    scope: "all",
    tools: [tool("spaces-vespa-search", 10, "hit"), tool("kb-search", 20, "kb chunk")],
  });
  expect(Date.now() - started).toBeLessThan(150);
  expect(sections.map((s) => s.heading)).toContain("Knowledge base");
  expect(sections).toHaveLength(5);
});
