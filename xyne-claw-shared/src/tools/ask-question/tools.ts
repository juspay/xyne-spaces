import crypto from "node:crypto";
import type { ToolDefinition } from "../types.js";

export const ASK_QUESTION_CONFIG_SCHEMA = {
  CLAW_AUTH_URL: {
    label: "Claw Auth Service URL",
    default: "http://localhost:3003",
    required: true as const,
    placeholder: "http://localhost:3003",
  },
};

export const askUserQuestion: ToolDefinition = {
  slug: "ask-user-question",
  name: "Ask User Question",
  description:
    "Ask the user a question with 2-4 options. The user will see clickable buttons in the chat " +
    "and can pick one. A new agent run will automatically start with their answer as context. " +
    "IMPORTANT: After calling this tool, you MUST stop immediately. Do NOT continue working, " +
    "do NOT call any other tools, do NOT make assumptions about the answer. Just report that " +
    "you've asked the question and end your response. The user's answer will arrive in a new run.",
  source: "custom:ask-question",
  configSchema: ASK_QUESTION_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "The question to ask the user" },
      options: {
        type: "array",
        items: { type: "string" },
        description: "2-4 answer options the user can choose from",
      },
    },
    required: ["question", "options"],
  },
  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const question = params["question"] as string;
    const options = params["options"] as string[];

    if (!question) return "Error: question is required.";
    if (!options || options.length < 2 || options.length > 4) {
      return "Error: provide 2-4 options.";
    }

    const meta = context.meta ?? {};
    const authUrl = context.config["CLAW_AUTH_URL"] ?? "http://localhost:3003";
    const questionId = crypto.randomUUID();

    // Store question in xyne-claw-auth Redis
    try {
      const res = await fetch(`${authUrl}/api/v1/pending-questions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(context.s2sKey ? { "x-s2s-key": context.s2sKey } : {}),
        },
        body: JSON.stringify({
          questionId,
          userId: meta["userId"],
          agentSlug: meta["agentSlug"],
          channelId: meta["channelId"],
          conversationId: meta["conversationId"],
          question,
          options,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      const data = (await res.json()) as { success: boolean; error?: string };
      if (!data.success) return `Error storing question: ${data.error ?? "unknown"}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Push to pendingQuestions collector so it's included in callback
    context.pendingQuestions?.push({ questionId, question, options });

    return `STOP — Question posted to user: "${question}" with options: ${options.join(", ")}. Do NOT continue working. Do NOT call any more tools. Do NOT assume an answer. Simply tell the user you've asked the question and wait. A new agent run will start automatically when they answer.`;
  },
};
