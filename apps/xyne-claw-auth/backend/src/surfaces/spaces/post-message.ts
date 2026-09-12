import { spacesAppFetch } from "./client.js";

export interface AgentPostIdentity {
  spacesAppUserId: string;
  appToken: string;
}

export interface AgentPostMessageInput {
  channelId: string;
  conversationId?: string | null;
  markdownText: string;
  metadata?: Record<string, unknown>;
}

export async function postAgentMessage(
  identity: AgentPostIdentity,
  msg: AgentPostMessageInput,
): Promise<{ messageId?: string }> {
  return (await spacesAppFetch(
    "/chat/postMessage",
    {
      channelId: msg.channelId,
      ...(msg.conversationId ? { conversationId: msg.conversationId } : {}),
      markdownText: msg.markdownText,
      userId: identity.spacesAppUserId,
      ...(msg.metadata !== undefined ? { metadata: msg.metadata } : {}),
    },
    identity.appToken,
  )) as { messageId?: string };
}
