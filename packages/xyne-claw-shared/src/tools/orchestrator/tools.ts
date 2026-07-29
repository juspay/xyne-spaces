import type { ToolDefinition } from "../types.js";

export const proposeAgentCallTool: ToolDefinition = {
  slug: "propose-agent-call",
  name: "Propose agent call",
  description:
    "Post a user-approval card proposing that another agent run a specific task in this same Spaces thread. " +
    "Call this ONCE per user task after choosing the single best target agent; the user decides whether to run it.",
  source: "custom:orchestrator",
  inputSchema: {
    type: "object",
    properties: {
      agentSlug: { type: "string", description: "Slug of the target agent to propose running." },
      task: { type: "string", description: "Self-contained task the target agent should run if the user approves." },
      why: { type: "string", description: "Brief reason this agent is the right one for the task." },
    },
    required: ["agentSlug", "task", "why"],
  },
  async execute(): Promise<string> {
    return "propose-agent-call is executed by claw-auth as a System Tool; it is not available in-process.";
  },
};
