import type { ToolDefinition } from "../types.js";

const EXECUTED_BY_CLAW = async (): Promise<string> =>
  "xor-decide is executed by the claw runtime for subagents; it is not available in-process here.";

export const xorDecideTool: ToolDefinition = {
  slug: "xor-decide",
  name: "xor-decide",
  description:
    "Classify or extract from many items at once with the xor decision model — fast and cheap, run in parallel. " +
    "Give it items (each a piece of text, or an image) and typed questions; every item gets every question in one batch. " +
    "Question types: yesno (true/false), choice (pick one of your options), score (pick a level from your ordered list), " +
    "value (extract a string/int/float). Each answer comes with a confidence; answers below the threshold (default 0.7) " +
    "are marked unsure — treat unsure as unknown, never as a confident answer. Optional `expect` on a question is compared " +
    "exactly in code (✓/✗). Phrase questions about one concrete thing with exhaustive options; ask exact wording or numbers " +
    "as `value` questions, not as yes/no. Returns a summary per question and a table per item.",
  source: "custom:xor",
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "Up to 200 items: [{id, text?, image?, imagePath?}]. image is a base64 data URL; imagePath is a PNG/JPEG path inside your sandbox.",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            text: { type: "string" },
            image: { type: "string" },
            imagePath: { type: "string" },
          },
          required: ["id"],
        },
      },
      questions: {
        type: "array",
        description:
          "Up to 12 questions: [{id, question, type: yesno|choice|score|value, options?, dtype?, pattern?, expect?, threshold?}]. " +
          "choice: options {key: description} (2+). score: options [low, …, high]. value: dtype string|int|float, optional regex pattern.",
        items: { type: "object" },
      },
      context: { type: "string", description: "Shared context prepended to every item, e.g. what the items are and what matters." },
    },
    required: ["items", "questions"],
  },
  execute: EXECUTED_BY_CLAW,
};
