import { DatabaseClient } from '@/database/client';
import { radarApplier } from '@/services/radar/radarApplier';
import { canAccessConversation, viewerChannelAccess } from '@/services/radar/radarAcl';
import {
  radarScopeFor,
  dmChannelIdFromScopeKey,
  type RadarScope,
} from '@/services/radar/radarScope';
import { ChannelScopeType } from '@xyne/shared';
import type { ApplyOperation } from '@/services/radar/radarApplier';

const prisma = DatabaseClient.getInstance();

/** One click resolves at most this many; the rest survive for the next one. */
const MAX_RESOLVE_ALL_ITEMS = 200;

export class RadarActionError extends Error {
  constructor(
    public code: 'not-found' | 'bad-request' | 'forbidden',
    message: string
  ) {
    super(message);
    this.name = 'RadarActionError';
  }
}

interface AuthContext {
  userId: string;
  workspaceId: string;
  /** Required: the ACL needs it to tell a guest from a member. */
  role: string;
}

/**
 * Manual CTAs — sync, no queue, no LLM. Two verbs, and the difference is who
 * they speak for: dismiss says "not mine" and only removes the actor, resolve
 * says "settled" and closes the item for everyone, so it is limited to the
 * people who asked. Who holds the ball otherwise is the parser's job.
 *
 * Each action goes through the applier's transaction and slams the watermark
 * to the latest message, so a parser job drained afterwards can never
 * re-litigate what a person just decided from a stale window.
 */
class RadarManualActionsService {
  async resolveItem(auth: AuthContext, itemId: string) {
    const item = await this.loadOpenItem(auth, itemId);
    // Either side may close it — the assignee finished it, or the requester
    // withdrew it. A bystander may not.
    if (!item.requestedBy.includes(auth.userId) && !item.pendingOn.includes(auth.userId)) {
      throw new RadarActionError('forbidden', 'Only someone involved in this item can resolve it');
    }
    const { scope } = await this.resolveScope(auth, item.conversationId);
    return this.applyManual(auth, item.conversationId, scope, [
      { op: 'resolve', itemId: item.id, conversationId: item.conversationId },
    ]);
  }

  async dismissItem(auth: AuthContext, itemId: string) {
    const item = await this.loadOpenItem(auth, itemId);
    if (!item.pendingOn.includes(auth.userId)) {
      throw new RadarActionError('forbidden', 'This item is not pending on you');
    }
    const { scope } = await this.resolveScope(auth, item.conversationId);
    return this.applyManual(auth, item.conversationId, scope, [
      { op: 'dismiss', itemId: item.id, conversationId: item.conversationId },
    ]);
  }

  async dismissAllInScope(auth: AuthContext, scopeKey: string) {
    const { where, conversationId, scope } = await this.resolveScope(auth, scopeKey);
    const items = await prisma.executionItem.findMany({
      where: {
        ...where,
        workspaceId: auth.workspaceId,
        status: 'OPEN',
        pendingOn: { has: auth.userId },
      },
      select: { id: true, conversationId: true },
      take: MAX_RESOLVE_ALL_ITEMS,
    });
    if (items.length === 0) {
      return { created: 0, resolved: 0, reassigned: 0, dismissed: 0 };
    }
    return this.applyManual(
      auth,
      conversationId,
      scope,
      items.map((i) => ({ op: 'dismiss' as const, itemId: i.id, conversationId: i.conversationId }))
    );
  }

  async resolveAllInScope(auth: AuthContext, scopeKey: string) {
    // ACL before the lookup: checking after made "empty scope" (200) and
    // "denied" (404) an oracle for whether it has open items.
    const { where, conversationId, scope } = await this.resolveScope(auth, scopeKey);
    // Bounded: the remainder stays open for the next click, which beats a
    // transaction that times out and rolls the whole batch back.
    const items = await prisma.executionItem.findMany({
      where: {
        ...where,
        workspaceId: auth.workspaceId,
        status: 'OPEN',
        OR: [{ requestedBy: { has: auth.userId } }, { pendingOn: { has: auth.userId } }],
      },
      select: { id: true, conversationId: true },
      take: MAX_RESOLVE_ALL_ITEMS,
    });
    if (items.length === 0) {
      return { created: 0, resolved: 0, reassigned: 0, dismissed: 0 };
    }
    return this.applyManual(
      auth,
      conversationId,
      scope,
      items.map((i) => ({ op: 'resolve' as const, itemId: i.id, conversationId: i.conversationId }))
    );
  }

  /**
   * A card addresses itself by scope key, so "all" means every item the card
   * shows. For a DM that spans the channel's conversations — narrowing to one
   * would clear a fraction of what the person is looking at.
   *
   * Authorization follows the scope: channel access for a DM, conversation
   * access for a thread. Denied and empty stay indistinguishable either way.
   */
  private async resolveScope(auth: AuthContext, scopeKey: string) {
    const dmChannelId = dmChannelIdFromScopeKey(scopeKey);
    if (dmChannelId) {
      const access = await viewerChannelAccess(auth, [dmChannelId]);
      if (!access.get(dmChannelId)?.allowed) {
        throw new RadarActionError('not-found', 'Execution item not found');
      }
      // The prefix arrives in the URL, so it is a claim, not a fact. Without
      // this a member of any channel could ask for channel-wide scope on it by
      // pasting `dm:<channelId>` — only the DM scope is allowed to widen.
      const channel = await prisma.channel.findUnique({
        where: { id: dmChannelId },
        select: { scopeType: true },
      });
      if (channel?.scopeType !== ChannelScopeType.DM) {
        throw new RadarActionError('not-found', 'Execution item not found');
      }
      // Every item in a DM is filed against one of its conversations, so the
      // representative only has to be one the viewer can reach.
      const anyItem = await prisma.executionItem.findFirst({
        where: { channelId: dmChannelId, workspaceId: auth.workspaceId, status: 'OPEN' },
        select: { conversationId: true },
        orderBy: { updatedAt: 'desc' },
      });
      return {
        where: { channelId: dmChannelId },
        // Only used to file audit rows for ops that did not carry their own.
        conversationId: anyItem?.conversationId ?? '',
        scope: radarScopeFor(ChannelScopeType.DM, dmChannelId, anyItem?.conversationId ?? ''),
      };
    }

    if (!(await canAccessConversation(auth, scopeKey))) {
      throw new RadarActionError('not-found', 'Execution item not found');
    }
    const conversation = await prisma.conversation.findUnique({
      where: { conversationId: scopeKey },
      select: { channelId: true, channel: { select: { scopeType: true } } },
    });
    return {
      where: { conversationId: scopeKey },
      conversationId: scopeKey,
      // Resolved from the channel, so a DM conversationId sent straight to a
      // bulk route cannot leave the item query and the writes disagreeing.
      scope: radarScopeFor(
        conversation?.channel?.scopeType ?? null,
        conversation?.channelId ?? '',
        scopeKey
      ),
    };
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
        requestedBy: true,
        pendingOn: true,
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
    if (item.status !== 'OPEN') {
      throw new RadarActionError('bad-request', 'Execution item is not open');
    }
    return item;
  }

  private async applyManual(
    auth: AuthContext,
    conversationId: string,
    scope: RadarScope,
    operations: Array<Omit<ApplyOperation, 'sourceMessageId'>>
  ) {
    // Under thread scope the watermark is slammed to the thread's latest
    // message, so the parser cannot re-litigate from a stale window.
    //
    // Under DM scope it is NOT. That watermark covers the whole channel, so
    // advancing it would consume every message the parser has not read yet —
    // including asks the other person sent that nobody has seen. The guard it
    // was protecting is already there without it: resolve and reassign match
    // only status = 'OPEN', and the validator drops a resolve of anything else,
    // so a stale re-parse of this item is a no-op. One avoidable parse is a
    // better trade than silently swallowing someone's request.
    const latest = scope.isDmChannel
      ? null
      : await prisma.message.findFirst({
          where: { conversationId, isDeleted: false },
          orderBy: [{ createdAt: 'desc' }, { messageId: 'desc' }],
          select: { messageId: true, createdAt: true },
        });
    const watermark = scope.isDmChannel
      ? undefined
      : latest
        ? { createdAt: latest.createdAt, messageId: latest.messageId }
        : { createdAt: new Date(), messageId: '' };

    return radarApplier.apply({
      workspaceId: auth.workspaceId,
      conversationId,
      scope,
      // A CTA acts "as of" the latest message — recorded as its source in audit.
      operations: operations.map((op) => ({
        ...op,
        sourceMessageId: watermark?.messageId ?? '',
      })) as ApplyOperation[],
      ...(watermark ? { watermark } : {}),
      actorType: 'manual',
      actorId: auth.userId,
    });
  }
}

export const radarManualActions = new RadarManualActionsService();
