/**
 * spaces-research tool — spawns a child AgentSession for deep workspace research.
 *
 * The parent agent calls this tool to delegate focused research tasks.
 * The child session gets the same MCP tools (Spaces search, channels, tickets, etc.)
 * and runs its own agent loop independently.
 */

import { Type } from "@sinclair/typebox";
import {
  createAgentSession,
  AuthStorage,
  SessionManager,
  ModelRegistry,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { LITELLM, AGENT } from "./config.js";

import { createLogger } from "./logger.js";
const log = createLogger("research-tool");

const RESEARCH_SYSTEM_PROMPT = `You are a focused research agent for Xyne Spaces. Your ONLY job is to thoroughly research the given topic using your available Spaces tools and return structured findings.

## Research Protocol

1. **Broad search** — Run at least 4 searches with different keyword phrasings using spaces-search
2. **Find channels** — Use spaces-channels with the name filter to find topic-relevant channels (both public and private)
3. **Read conversations** — For each relevant channel found:
   - Use spaces-search with the "in" parameter (channel ID) to search within that channel
   - Use spaces-messages to read actual message threads
   - Use spaces-message-detail to read important messages in full
   - Look for decisions made, blockers discussed, ownership assignments
4. **Check tickets** — Search tickets by keyword (spaces-search with type="tickets"), read descriptions not just titles
5. **Identify stakeholders** — Look up every person mentioned using spaces-users, check their recent activity with spaces-activity
6. **Check for prior art** — Search for existing documents, PRDs, design docs mentioned in messages

If you find less than 10 relevant data points, you haven't searched enough.

## Output Format

Return your findings as structured markdown:

### Channels Found
- Channel name, ID, description, relevance

### Key Conversations
- What was discussed, who said what, key decisions or blockers

### Related Tickets
- Ticket title, status, assignee, description summary

### Stakeholders
- Name, role, recent activity, relevance to the topic

### Current State
- What has been done, what is in progress, what is blocked

### Recommendations
- Suggested next steps based on findings`;

export interface ResearchToolOptions {
  /** MCP + custom tools to pass to the child session */
  tools: ToolDefinition[];
}

export function createResearchTool(opts: ResearchToolOptions): ToolDefinition {
  return {
    name: "spaces-research",
    label: "Spaces Research",
    description:
      "Delegate a deep research task to a specialized research agent. " +
      "The research agent searches channels, reads conversations, checks tickets, " +
      "and identifies stakeholders — then returns structured findings. " +
      "Use this for thorough workspace discovery instead of searching manually. " +
      "Provide a clear, detailed topic description.",
    parameters: Type.Object({
      topic: Type.String({ description: "What to research — be specific about the goal, keywords, people, or areas to investigate" }),
    }),
    async execute(_toolCallId: string, params: unknown) {
      const { topic } = params as { topic: string };
      log.info(`[spaces-research] Starting research: ${topic.slice(0, 100)}`);

      try {
        const authStorage = AuthStorage.create();
        const modelRegistry = ModelRegistry.create(authStorage);

        // Register LiteLLM provider (same as parent)
        modelRegistry.registerProvider("litellm", {
          baseUrl: LITELLM.url,
          apiKey: LITELLM.apiKey,
          api: "openai-completions",
          authHeader: true,
          models: [
            {
              id: LITELLM.model,
              name: LITELLM.model,
              reasoning: false,
              input: ["text", "image"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 200000,
              maxTokens: 16384,
            },
          ],
        });

        const model = modelRegistry.find("litellm", LITELLM.model);
        if (!model) throw new Error("Failed to resolve LiteLLM model for research agent");

        // Create an ephemeral in-memory session — no persistence needed
        const { session } = await createAgentSession({
          model,
          thinkingLevel: AGENT.thinkingLevel as ThinkingLevel,
          tools: [],
          sessionManager: SessionManager.inMemory(),
          authStorage,
          modelRegistry,
          customTools: opts.tools, // Same MCP tools as parent
        });

        // Subscribe for logging
        const toolsUsed: string[] = [];
        session.subscribe((event) => {
          if (event.type === "tool_execution_start") {
            log.info(`[spaces-research] Tool: ${event.toolName} args=${JSON.stringify(event.args ?? {}).slice(0, 150)}`);
          }
          if (event.type === "tool_execution_end") {
            toolsUsed.push(event.toolName);
          }
        });

        const prompt = `${RESEARCH_SYSTEM_PROMPT}\n\n## Research Task\n${topic}`;
        await session.prompt(prompt);

        // Wait for event queue
        const sq = session as unknown as { _agentEventQueue?: Promise<void> };
        if (sq._agentEventQueue) await sq._agentEventQueue;

        const text = session.getLastAssistantText() ?? "(No findings)";
        session.dispose();

        log.info(`[spaces-research] Completed: ${toolsUsed.length} tools used, ${text.length} chars`);

        return {
          content: [{ type: "text" as const, text }],
          details: {},
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`[spaces-research] Failed:`, msg);
        return {
          content: [{ type: "text" as const, text: `Research failed: ${msg}` }],
          details: {},
        };
      }
    },
  };
}
