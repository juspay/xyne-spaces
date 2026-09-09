import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { extractUserMentions } from '@/utils/mentionParser';
import { radarParser, type ParserOperation } from '@/services/radar/radarParser';
import { radarApplier } from '@/services/radar/radarApplier';

const prisma = DatabaseClient.getInstance();
const TAG = '[RADAR-REACTION]';

/**
 * Reaction-driven resolution.
 *
 * A tick carries no text, so it never enters a parse window, and the message it
 * points at is usually already below the watermark — the window parser cannot
 * see it. But it is the cleanest signal Radar gets: the parser's hardest job is
 * guessing which message settles which item, and a reaction names the message
 * outright.
 *
 * The shape is deliberately flat. SQL answers the only question it can answer
 * cheaply — does this person hold anything here — and that discards almost
 * every reaction in a workspace. What survives goes to the parser as a normal
 * pass with a "reaction" field, judged by the same prompt and the same resolve
 * rule as typed messages, so a tick and the word "done" cannot settle a
 * conversation differently.
 */
class RadarReactionResolver {
  async onReaction(reactionId: string): Promise<void> {
    if (!config.radar.enabled) return;

    const reaction = await prisma.reaction.findUnique({
      where: { reactionId },
      select: { messageId: true, userId: true, emojiName: true, workspaceId: true },
    });
    if (!reaction) return;

    const message = await prisma.message.findUnique({
      where: { messageId: reaction.messageId },
      select: {
        messageId: true,
        content: true,
        conversationId: true,
        createdAt: true,
        isDeleted: true,
      },
    });
    if (!message || message.isDeleted) return;

    const conversation = await prisma.conversation.findUnique({
      where: { conversationId: message.conversationId },
      select: { channelId: true },
    });
    if (!conversation?.channelId) return;

    // The candidate set IS the authorization boundary: only items the reactor
    // already holds or already asked for. requestedBy counts as much as
    // pendingOn — the asker ticking the answer is the strongest confirmation
    // there is, and the more common half of the pattern.
    //
    // Asked first because it is indexed SQL and it eliminates nearly
    // everything: most reactions are from people who hold nothing in that
    // thread, and none of those should cost a token. Nothing is logged for
    // them either — a run row per thumbs-up would bury the ones worth reading.
    const candidates = await prisma.executionItem.findMany({
      where: {
        workspaceId: reaction.workspaceId,
        conversationId: message.conversationId,
        status: 'OPEN',
        OR: [{ pendingOn: { has: reaction.userId } }, { requestedBy: { has: reaction.userId } }],
      },
      // Unbounded on purpose: the predicates above already bound it to one
      // thread AND to items this person is party to, which is a handful.
      // Ordered newest-first only so the prompt is deterministic.
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        contextSummary: true,
        requestedBy: true,
        pendingOn: true,
        sourceMessageId: true,
      },
    });
    // Every reaction that gets this far is logged, including the ones that do
    // nothing. "I reacted and nothing happened" has to be answerable from the
    // debug panel, and "no row at all" is the one answer it cannot give.
    // Reuses the parser's run log — a reaction is a degenerate window, so
    // every column already means something.
    const startedAt = Date.now();
    const run = {
      workspaceId: reaction.workspaceId,
      conversationId: message.conversationId,
      gatePassed: false,
      gateReason: 'reaction-no-candidates',
      parserRan: false,
      proposedOps: undefined as unknown,
      validOps: undefined as unknown,
      droppedOps: undefined as unknown,
      applied: undefined as unknown,
      assessment: undefined as string | undefined,
      error: undefined as string | undefined,
    };

    try {
      if (candidates.length === 0) {
        run.assessment = `${reaction.emojiName}: reactor holds no open item in this thread.`;
        return;
      }

      // An item cannot be settled by a message posted before it was asked for.
      // Compared against the SOURCE MESSAGE, not the item row: the parser
      // writes items on a debounce, so item.createdAt trails the ask by up to
      // a window and would reject legitimate answers sent in between.
      const askedAt = new Map(
        (
          await prisma.message.findMany({
            where: { messageId: { in: candidates.map(c => c.sourceMessageId) } },
            select: { messageId: true, createdAt: true },
          })
        ).map(m => [m.messageId, m.createdAt]),
      );
      const eligible = candidates.filter(c => {
        const at = askedAt.get(c.sourceMessageId);
        return at ? at <= message.createdAt : true;
      });

      if (eligible.length === 0) {
        run.gateReason = 'reaction-predates-ask';
        run.assessment = `Reacted message predates all ${candidates.length} candidate item(s).`;
        return;
      }

      run.gatePassed = true;
      run.gateReason = 'reaction';

      const nameById = await this.namesFor([
        reaction.userId,
        ...eligible.flatMap(c => [...c.requestedBy, ...c.pendingOn]),
      ]);
      const reactorName = nameById.get(reaction.userId) ?? reaction.userId;

      run.parserRan = true;
      const transitions = await radarParser.parseWindow(
        eligible.map(c => ({
          id: c.id,
          title: c.title,
          context: c.contextSummary,
          requested_by: c.requestedBy,
          pending_on: c.pendingOn,
          source_message_id: c.sourceMessageId,
        })),
        [
          {
            id: message.messageId,
            author: { id: reaction.userId, name: reactorName },
            text: message.content,
            mentions: extractUserMentions(message.content).map(id => ({
              id,
              name: nameById.get(id) ?? id,
            })),
            timestamp_iso: message.createdAt.toISOString(),
          },
        ],
        Object.fromEntries(nameById),
        [],
        { by: reactorName, emoji: reaction.emojiName },
      );

      run.proposedOps = transitions.operations;
      run.assessment = transitions.assessment;

      // The model chose from a closed list; re-checking that it stayed inside
      // it, and that it only resolved, is what keeps a hallucinated id or a
      // stray create out of the applier.
      const openById = new Set(eligible.map(c => c.id));
      const valid = transitions.operations.filter(
        op => op.op === 'resolve' && op.itemId && openById.has(op.itemId),
      );
      const dropped = transitions.operations.filter(op => !valid.includes(op));
      if (dropped.length > 0) run.droppedOps = dropped;
      if (valid.length === 0) return;

      const operations: ParserOperation[] = valid.map(op => ({
        ...op,
        sourceMessageId: message.messageId,
      }));
      run.validOps = operations;

      run.applied = await radarApplier.apply({
        workspaceId: reaction.workspaceId,
        conversationId: message.conversationId,
        channelId: conversation.channelId,
        operations,
        // No watermark: this settles one item and consumes no window.
        // Advancing it would silently swallow every unparsed message here.
        actorType: 'reaction',
        actorId: reaction.userId,
      });

      logger.info(`${TAG} resolved by reaction`, {
        itemIds: operations.map(o => o.itemId),
        emoji: reaction.emojiName,
        conversationId: message.conversationId,
      });
    } catch (error) {
      // A reaction is an optimisation, never the only route to a resolve — a
      // parser outage must not surface to the person who clicked an emoji.
      run.error = error instanceof Error ? error.message : String(error);
      logger.warn(`${TAG} reaction pass failed`, { error: run.error });
    } finally {
      await prisma.executionRunLog
        .create({
          data: {
            workspaceId: run.workspaceId,
            conversationId: run.conversationId,
            gatePassed: run.gatePassed,
            gateReason: run.gateReason,
            windowSize: 1,
            parserRan: run.parserRan,
            proposedOps: run.proposedOps as object | undefined,
            validOps: run.validOps as object | undefined,
            droppedOps: run.droppedOps as object | undefined,
            applied: run.applied as object | undefined,
            assessment: run.assessment,
            error: run.error,
            durationMs: Date.now() - startedAt,
          },
        })
        .catch(error => logger.warn(`${TAG} run log write failed`, { error }));
    }
  }

  private async namesFor(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const users = await prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map(u => [u.id, u.name]));
  }
}

export const radarReactionResolver = new RadarReactionResolver();
