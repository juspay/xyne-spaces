import type { ToolDefinition } from "../types.js";

export const PLAN_STATUSES = ["pending", "in_progress", "completed", "failed"] as const;

export const updatePlan: ToolDefinition = {
  slug: "update-plan",
  name: "Update Plan",
  description:
    "Show the user your plan and keep it current. Call it at the start of any multi-step task with the ordered steps, " +
    "then call it again whenever a step starts, finishes or fails so the checklist beside the chat stays accurate. " +
    "Pass the full list every time.",
  source: "custom:workspace-plan",
  harness: "local",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title for the plan." },
      todos: {
        type: "array",
        description: "Ordered steps with their current status.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Short stable id, e.g. t1." },
            title: { type: "string", description: "What the step does, in one line." },
            status: { type: "string", enum: [...PLAN_STATUSES], description: "pending, in_progress, completed or failed." },
          },
          required: ["id", "title", "status"],
        },
      },
    },
    required: ["todos"],
  },
  async execute() {
    return "Use propose-plan on server runs.";
  },
};
