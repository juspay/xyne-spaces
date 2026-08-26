// Host → Workflow Studio event bridge. The SDK's EVENT triggers are passive:
// the host decides a domain event happened, dispatchEvent() matches it against
// active workflows and enqueues. Fire-and-forget — a workflow must never fail
// the write that produced the event.

import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { workflowSdkRuntime } from './runtime';
import { MESSAGE_RECEIVED_EVENT } from './triggers/message-received.trigger';

export interface MessageReceivedEvent {
  messageId: string;
  conversationId: string;
  channelId: string;
  userId: string;
  msgType?: string | undefined;
}

/**
 * Runs on every message in the product, so it does the minimum: resolve the
 * channel's workspace (dispatchEvent needs it to scope its query) and pass ids
 * through. Content/author enrichment lives in the trigger's hydratePayload,
 * which the runtime calls only for workflows that actually listen.
 */
export async function dispatchMessageReceived(message: MessageReceivedEvent): Promise<void> {
  // Gated here, not at the call sites: when Studio is off the cost of a message
  // must be a boolean, not a channel read.
  if (!config.workflowStudioEnabled) return;
  try {
    const channel = await db.channel
      .findUnique({
        where: { id: message.channelId },
        select: { workspaceId: true, name: true },
      })
      .catch(() => null);

    if (!channel?.workspaceId) return;

    await workflowSdkRuntime.dispatchEvent({
      type: MESSAGE_RECEIVED_EVENT,
      payload: {
        messageId: message.messageId,
        conversationId: message.conversationId,
        channelId: message.channelId,
        channelName: channel.name ?? null,
        authorId: message.userId,
        msgType: message.msgType ?? 'USER',
      },
      // Scopes findActiveWorkflows().
      metadata: { workspaceId: channel.workspaceId },
    });
  } catch (err) {
    logger.error('[WORKFLOW-SDK] dispatchMessageReceived failed', {
      messageId: message.messageId,
      error: err,
    });
  }
}
