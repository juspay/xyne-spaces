import { v4 as uuidv4 } from 'uuid';
import { MessageType, Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { parseBitbucketPrUrl } from '@/utils/repoUrlParser';

interface BroadcastPRUpdateParams {
  prUrl: string;
  content: string;
  senderId: string;
  /** Skip this conversation (e.g. the ticket's own thread, already posted to). */
  excludeConversationId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Mirror a PR lifecycle update (merged, build status, …) into every channel
 * thread subscribed to the PR — i.e. threads where the PR link was posted and
 * the "Run PR Check" button was created (pr_thread_links).
 *
 * Best-effort: failures are logged and never propagate to the caller.
 */
async function broadcastPRUpdate(params: BroadcastPRUpdateParams): Promise<void> {
  try {
    const prRef = parseBitbucketPrUrl(params.prUrl);
    if (!prRef) {
      logger.warn(
        `[PR-Thread-Notify] Could not parse PR URL "${params.prUrl}" — skipping thread broadcast`
      );
      return;
    }

    // Exact structured match — substring matching on the URL would let a
    // similarly-named repo/project collide with another PR's threads.
    // The exclusion skips the thread the caller already posted to directly
    // (the ticket's own conversation).
    const links = await db.prThreadLink.findMany({
      where: {
        prId: prRef.prId,
        projectKey: { equals: prRef.projectKey, mode: 'insensitive' },
        repositorySlug: { equals: prRef.repositorySlug, mode: 'insensitive' },
        ...(params.excludeConversationId
          ? { conversationId: { not: params.excludeConversationId } }
          : {}),
      },
      select: { conversationId: true, workspaceId: true },
    });
    if (links.length === 0) return;

    // Broadcasts to different conversations are independent — run them
    // concurrently; within one conversation the message and the reply-count
    // bump commit atomically so a failure can't leave a phantom message.
    const results = await Promise.all(
      links.map(async ({ conversationId, workspaceId }): Promise<boolean> => {
        try {
          const now = new Date();
          await db.$transaction([
            db.message.create({
              data: {
                messageId: uuidv4(),
                conversationId,
                workspaceId,
                senderId: params.senderId,
                content: params.content,
                msgType: MessageType.SYSTEM,
                hasAttachment: false,
                edited: false,
                isDeleted: false,
                isSent: true,
                showInChannel: false,
                createdAt: now,
                ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
              },
            }),
            // Surface the update in the thread: bump reply count / activity so
            // the merge-channel thread visibly moves when the PR progresses.
            db.conversation.update({
              where: { conversationId },
              data: {
                replyCount: { increment: 1 },
                lastActivityAt: now,
              },
            }),
            // Bump each participant's lastReplyAt so the thread rises in the
            // sidebar — userConversationsPaginatedV2 orders by this field.
            db.conversationParticipant.updateMany({
              where: { conversationId },
              data: { lastReplyAt: now },
            }),
          ]);
          return true;
        } catch (error) {
          logger.error(
            `[PR-Thread-Notify] Failed to post PR update to conversation ${conversationId}:`,
            error
          );
          return false;
        }
      })
    );

    const delivered = results.filter(Boolean).length;
    logger.info(
      `[PR-Thread-Notify] Mirrored PR #${prRef.prId} (${prRef.repositorySlug}) update to ${delivered}/${links.length} linked thread(s)`
    );
  } catch (error) {
    logger.error('[PR-Thread-Notify] Failed to broadcast PR update:', error);
  }
}

export const prThreadNotificationService = { broadcastPRUpdate };
