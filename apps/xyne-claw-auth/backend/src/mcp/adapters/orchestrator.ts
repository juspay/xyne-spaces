import type { McpToolInfo } from "../types.js";

export const ORCHESTRATOR_TOOLS: McpToolInfo[] = [
  {
    name: "perform_agent_call",
    description:
      "Run another visible agent immediately in the current Spaces thread with a self-contained task. " +
      "Use this once after selecting the single best agent; no user approval card is posted.",
    inputSchema: {
      type: "object",
      properties: {
        agentSlug: { type: "string", description: "Slug of the target agent to run." },
        task: { type: "string", description: "Self-contained task the target agent should run." },
      },
      required: ["agentSlug", "task"],
    },
    selectionKey: "perform_agent_call",
  },
];

export const ORCHESTRATOR_TOOL_NAMES = ORCHESTRATOR_TOOLS.map((t) => t.name);
