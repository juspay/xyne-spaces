import crypto from "node:crypto";
import type { ToolDefinition } from "../types.js";

/**
 * Copilot-only tool. Injected when a user's provider is "copilot".
 * NOT registered in the global tool registry — conditionally added at runtime.
 *
 * The agent must use this tool for every response. It pushes the message
 * to pendingResponses (collected by the caller), returns STOP so the
 * agent halts, and the webhook result handler posts the message to the user.
 *
 * When the user replies (thread reply), the session is resumed with
 * their reply injected as a tool result, keeping the agent loop coherent.
 */
export const respondToUser: ToolDefinition = {
  slug: "respond-to-user",
  name: "Respond to User",
  description: [
    "Send your response to the user and wait for their reply.",
    "",
    "IMPORTANT — use this tool for EVERY response you want to deliver to the user.",
    "Do NOT write plain assistant messages; put all your output here instead.",
    "After calling this tool, you MUST stop immediately. Do NOT continue working,",
    "do NOT call any other tools, do NOT make assumptions about what the user will say.",
    "The user's reply will arrive automatically in the next turn.",
  ].join("\n"),
  source: "custom:copilot",
  inputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          "Your complete response or question to present to the user. " +
          "This is displayed as a message in the chat thread.",
      },
    },
    required: ["message"],
  },
  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const message = params["message"] as string;
    if (!message) return "Error: message is required.";

    const responseId = crypto.randomUUID();
    context.pendingResponses?.push({ responseId, message });

    return (
      "STOP — Response delivered to user. " +
      "Do NOT continue working. Do NOT call any more tools. " +
      "Do NOT make assumptions about the user's reply. " +
      "Simply acknowledge that you've sent the response and stop."
    );
  },
};

/**
 * System prompt addition for copilot mode.
 * Injected alongside the respond-to-user tool.
 */
export const COPILOT_SYSTEM_INSTRUCTION = `
## Response Channel — REQUIRED

You are running in copilot mode. The user communicates through a chat thread,
not a direct input box. You MUST follow these rules on every single turn:

1. Never write a plain assistant message to deliver a response or ask a question.
2. Instead, call the \`respond-to-user\` tool with your complete response in the
   \`message\` argument.
3. After calling respond-to-user, STOP immediately. Do not call any other tools.
4. Wait for the user's reply to arrive in the next turn, then continue from there.
5. Keep iterating — call \`respond-to-user\` again whenever you need to say
   something new or ask a follow-up question.

This is the ONLY way the user can see your responses in this context.
`.trim();
