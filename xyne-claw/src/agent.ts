import {
  createAgentSession,
  AuthStorage,
  SessionManager,
  ModelRegistry,
  codingTools,
  type CreateAgentSessionOptions,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-ai";
import { AGENT, LITELLM, PATHS } from "./config.js";

export interface Attachment {
  fileName: string;
  mimeType: string;
  data: string; // base64-encoded file content
}

export interface RunResult {
  readonly text: string;
  readonly toolsUsed: string[];
  readonly attachments?: Attachment[];
}

function buildSystemPrompt(userId: string, userName?: string, userEmail?: string): string {
  const identity = userName ? `**${userName}** (ID: ${userId})` : `user ID **${userId}**`;
  const emailLine = userEmail ? `\n- **Email:** ${userEmail}` : "";

  return `You are the **Digital Twin** of ${identity}. You act, think, and respond exactly as this person would.

## Identity
You ARE this user's digital representative. When someone asks you a question, they are asking ${userName ?? "this user"} — not a generic assistant. Your job is to respond the way this person would, using their knowledge, context, communication style, and expertise.
- **User ID:** ${userId}
- **Name:** ${userName ?? "unknown"}${emailLine}

Use these details when filtering tool results (e.g. pass the user's name or email to search/filter tools to scope results to this user).

## How to Build Context (do this FIRST)
Before answering any query, use your available tools to gather context. Look at the tools you have access to — they include tools for searching messages, tickets, activity, memory, users, channels, and more. Use them proactively:

1. **Recent activity** — Check for mentions, replies, and assignments.
2. **Knowledge base** — Search memory/facts/SOPs relevant to the query.
3. **Messages & conversations** — Read threads to understand communication style.
4. **Tickets & work items** — Check current workload and priorities.
5. **Search** — Broad search across all connected apps for relevant context.
6. **People lookup** — Resolve names to user IDs when needed.

Note: Tool names may be prefixed with the server name (e.g. \`xyne-spaces__spaces-search\`). Use the tools as they appear in your tool list.

## How to Respond
- **Mirror the user's communication style.** If they write short direct messages, you do too. If they use detailed explanations, match that.
- **Use the user's actual knowledge.** Ground every answer in data from their messages, tickets, memory, and activity. Do not guess.
- **For engineering queries** — use any available code/log/metrics tools.
- **Be the user.** Respond in first person ("I", "my", "we") as if you are them. Do not say "the user" or "they".
- **Acknowledge gaps honestly.** If you cannot find relevant information in the user's data, say so — don't fabricate.

## Critical Rules
1. NEVER fabricate information. Only use data retrieved from tools.
2. ALWAYS gather context before responding — do not answer from thin air.
3. Respond as the user, not as an assistant describing the user.
4. When the query is about "what are you working on" or "what do you know about X", search the user's actual data first.
5. Use the tools available to you — check your tool list, don't assume tool names.`;
}

function buildUserDetails(userId: string, userName?: string, userEmail?: string): string {
  const lines = [
    "## Current User",
    `- **User ID:** ${userId}`,
    `- **Name:** ${userName ?? "unknown"}`,
  ];
  if (userEmail) lines.push(`- **Email:** ${userEmail}`);
  lines.push("", "Use these details when filtering tool results (e.g. pass the user's name or email to search/filter tools to scope results to this user).");
  return lines.join("\n");
}

function resolveModel(modelRegistry: ModelRegistry) {
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
  if (!model) {
    throw new Error(`Failed to register LiteLLM model "${LITELLM.model}" at ${LITELLM.url}`);
  }
  return model;
}

export async function runTask(
  userId: string,
  task: string,
  context?: string,
  userName?: string,
  userEmail?: string,
  customTools?: ToolDefinition[],
  systemPromptOverride?: string,
  cwd?: string,
): Promise<RunResult> {
  console.log(`[agent] Running task for user ${userId} (${userName ?? "unknown"}): ${task.slice(0, 100)}`);

  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);
  const model = resolveModel(modelRegistry);

  const options: CreateAgentSessionOptions = {
    model,
    thinkingLevel: AGENT.thinkingLevel as ThinkingLevel,
    tools: codingTools,
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
    cwd: cwd ?? PATHS.dataDir,
  };
  if (PATHS.agentDir) {
    options.agentDir = PATHS.agentDir;
  }
  if (customTools) {
    options.customTools = customTools;
  }

  const { session } = await createAgentSession(options);

  const toolsUsed: string[] = [];

  session.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      console.log(`[agent] Tool call: ${event.toolName} args=${JSON.stringify(event.args ?? {}).slice(0, 200)}`);
    }
    if (event.type === "tool_execution_end") {
      toolsUsed.push(event.toolName);
      console.log(`[agent] Tool done: ${event.toolName}`);
    }
  });

  const basePrompt = systemPromptOverride ?? buildSystemPrompt(userId, userName, userEmail);
  const userDetails = buildUserDetails(userId, userName, userEmail);
  const systemPrompt = systemPromptOverride ? `${basePrompt}\n\n${userDetails}` : basePrompt;
  const contextBlock = context ? `\n\n## Additional Context\n${context}` : "";
  const prompt = `${systemPrompt}${contextBlock}\n\n## Query\n${task}`;
  await session.prompt(prompt);

  const text = session.getLastAssistantText() ?? "";

  session.dispose();

  return { text, toolsUsed };
}
