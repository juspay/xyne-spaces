import { DatabaseClient } from '@/database/client';
import { radarApplier } from '@/services/radar/radarApplier';
import { canAccessConversation } from '@/services/radar/radarAcl';
import type { ParserOperation } from '@/services/radar/radarParser';

const prisma = DatabaseClient.getInstance();

/** One click resolves at most this many; the rest survive for the next one. */
const MAX_RESOLVE_ALL_ITEMS = 200;

export class RadarActionError extends Error {
  constructor(
    public code: 'not-found' | 'bad-request',
    message: string,
  ) {
    super(message);
    this.name = 'RadarActionError';
  }
}

interface AuthContext {
  userId: string;
  workspaceId: string;
}

/**
 * Manual CTAs — sync, no queue, no LLM. Resolve is the only manual verb; who
 * holds the ball is the parser's job.
 *
 * Each action goes through the applier's transaction and slams the watermark
 * to the latest message, so a parser job drained afterwards can never
 * re-litigate what a person just decided from a stale window.
 */
class RadarManualActionsService {
  async resolveItem(auth: AuthContext, itemId: string) {
    const item = await this.loadOpenItem(auth, itemId);
    return this.applyManual(auth, item.conversationId, item.channelId, [
      { op: 'resolve', itemId: item.id },
    ]);
  }

  async resolveAllInThread(auth: AuthContext, conversationId: string) {
    // ACL before the lookup: checking after made "empty thread" (200) and
    // "denied" (404) an oracle for whether a conversation has open items.
    if (!(await canAccessConversation(auth, conversationId))) {
      throw new RadarActionError('not-found', 'Execution item not found');
    }
    // Bounded: the remainder stays open for the next click, which beats a
    // transaction that times out and rolls the whole batch back.
    const items = await prisma.executionItem.findMany({
      where: { conversationId, workspaceId: auth.workspaceId, status: 'open' },
      select: { id: true, channelId: true },
      take: MAX_RESOLVE_ALL_ITEMS,
    });
    if (items.length === 0) {
      return { created: 0, resolved: 0, reassigned: 0 };
    }
    return this.applyManual(
      auth,
      conversationId,
      items[0].channelId,
      items.map(i => ({ op: 'resolve' as const, itemId: i.id })),
    );
  }

  private async loadOpenItem(auth: AuthContext, itemId: string) {
    const item = await prisma.executionItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        workspaceId: true,
        conversationId: true,
        channelId: true,
        status: true,
      },
    });
    if (!item || item.workspaceId !== auth.workspaceId) {
      throw new RadarActionError('not-found', 'Execution item not found');
    }
    // Same rule as reading, and resolved from the conversation rather than the
    // item's channelId stamp: acting on an item requires access to its thread.
    if (!(await canAccessConversation(auth, item.conversationId))) {
      throw new RadarActionError('not-found', 'Execution item not found');
    }
    if (item.status !== 'open') {
      throw new RadarActionError('bad-request', 'Execution item is not open');
    }
    return item;
  }

  private async applyManual(
    auth: AuthContext,
    conversationId: string,
    channelId: string,
    operations: Array<Omit<ParserOperation, 'sourceMessageId'>>,
  ) {
    // Watermark := latest message. Anything at or before "now" is consumed —
    // the parser only ever sees messages sent after this action.
    const latest = await prisma.message.findFirst({
      where: { conversationId, isDeleted: false },
      orderBy: [{ createdAt: 'desc' }, { messageId: 'desc' }],
      select: { messageId: true, createdAt: true },
    });
    const watermark = latest
      ? { createdAt: latest.createdAt, messageId: latest.messageId }
      : { createdAt: new Date(), messageId: '' };

    return radarApplier.apply({
      workspaceId: auth.workspaceId,
      conversationId,
      channelId,
      // A CTA acts "as of" the latest message — recorded as its source in audit.
      operations: operations.map(op => ({
        ...op,
        sourceMessageId: watermark.messageId,
      })) as ParserOperation[],
      watermark,
      actorType: 'manual',
      actorId: auth.userId,
    });
  }
}

export const radarManualActions = new RadarManualActionsService();
