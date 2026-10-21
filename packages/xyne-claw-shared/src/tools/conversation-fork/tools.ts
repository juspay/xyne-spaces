import type { ToolDefinition } from "../types.js";

export const FORK_TO_CONVERSATION_TOOL = "fork-to-conversation";

export const forkToConversationTool: ToolDefinition = {
  slug: FORK_TO_CONVERSATION_TOOL,
  name: "Fork to Conversation",
  description:
    "Continue this conversation somewhere else: hand your context over to another Spaces thread or channel. " +
    "Use it when the user asks you to fork or move yourself to another thread, channel, or a document's conversation. " +
    "Pass exactly one target: conversationId for an existing thread (for example a Tech Doc's discussion), or channelId to start a new thread in a channel. " +
    "Write `summary` as a handoff note for whoever reads the new thread: the goal, what was decided, the ids and links that matter, what is done, and what is still open or waiting for approval. " +
    "The user sees an Approve/Decline card with the target and the summary. Nothing is posted until they approve. " +
    "On approval the summary is posted in the target with a link back to this thread, and your full memory of this thread is copied there so follow-ups in the new thread continue where this one stopped.",
  source: "custom:agent-tools",
  isWriteTool: true,
  inputSchema: {
    type: "object",
    properties: {
      conversationId: {
        type: "string",
        description: "Existing Spaces conversation (thread) to fork into. Use this or channelId, not both.",
      },
      channelId: {
        type: "string",
        description: "Spaces channel to start a new thread in. Use this or conversationId, not both.",
      },
      summary: {
        type: "string",
        description: "Handoff note posted in the target thread: goal, decisions, key ids and links, done, and open items.",
      },
    },
    required: ["summary"],
  },
  execute: async () =>
    "fork-to-conversation is an approval-gated write tool: the user will receive an Approve/Decline card. Nothing is posted until they approve.",
};
