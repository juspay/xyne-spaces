import type { ToolDefinition } from "../types.js";

export const performAgentCallTool: ToolDefinition = {
  slug: "perform_agent_call",
  name: "Perform agent call",
  description:
    "Run another visible agent immediately with a self-contained task in this same Spaces thread. " +
    "Call this once after choosing the single best target agent; no user approval card is posted.",
  source: "custom:orchestrator",
  inputSchema: {
    type: "object",
    properties: {
      agentSlug: { type: "string", description: "Slug of the target agent to run." },
      task: { type: "string", description: "Self-contained task the target agent should run." },
    },
    required: ["agentSlug", "task"],
  },
  async execute(): Promise<string> {
    return "perform_agent_call is executed by claw-auth as a System Tool; it is not available in-process.";
  },
};
