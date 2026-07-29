import type { McpToolInfo } from "../types.js";

export const ORCHESTRATOR_TOOLS: McpToolInfo[] = [
  {
    name: "propose-agent-call",
    description:
      "Post a signed card in the current Spaces thread proposing that a user run another agent with a specific task. " +
      "Use this ONCE per user task after selecting the single best agent; the user decides whether to run it.",
    inputSchema: {
      type: "object",
      properties: {
        agentSlug: { type: "string", description: "Slug of the target agent to propose running." },
        task: { type: "string", description: "Self-contained task the target agent should run if the user approves." },
        why: { type: "string", description: "Brief reason this target agent is appropriate." },
      },
      required: ["agentSlug", "task", "why"],
    },
    selectionKey: "propose-agent-call",
  },
];

export const ORCHESTRATOR_TOOL_NAMES = ORCHESTRATOR_TOOLS.map((t) => t.name);
