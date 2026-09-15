import type { Prisma } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import type { ParserOperation } from '@/services/radar/radarParser';
import type { RadarScope } from '@/services/radar/radarScope';

/**
 * An operation plus, optionally, the conversation it belongs to. Manual bulk
 * actions know this per item; the parser path derives it from the source
 * message instead.
 */
export type ApplyOperation = ParserOperation & { conversationId?: string };

const prisma = DatabaseClient.getInstance();

/** Headroom over Prisma's 5s default for a whole-thread resolve-all batch. */
const APPLY_TRANSACTION_TIMEOUT_MS = 30_000;

/** Enforced here, not only in the validator: resolve-all bypasses that path. */
const MAX_OPERATIONS_PER_TRANSACTION = 200;

export interface ApplyParams {
  workspaceId: string;
  /** Stamped on created items and audit rows when the window does not report a
   *  per-message conversation. */
  conversationId: string;
  /**
   * What this write is scoped to. One value, not a key plus a flag: two
   * optional fields could disagree, and a mismatch shows up only as a guarded
   * update matching nothing while the watermark advances anyway.
   *
   * It decides the watermark row, and whether the guarded predicates narrow by
   * channel (a DM, whose window spans sibling conversations) or by conversation.
   */
  scope: RadarScope;
  /** sourceMessageId -> conversationId, for a window spanning conversations. */
  conversationBySourceMessage?: Map<string, string>;
  /** Validator-approved operations only — the applier trusts its input. */
  operations: ApplyOperation[];
  /**
   * The window's last message: items + audit + watermark commit atomically.
   * Omitted by callers that settle ONE item without consuming a window — a
   * reaction resolve must not swallow messages nobody has parsed yet.
   */
  watermark?: { createdAt: Date; messageId: string };
  actorType: 'llm' | 'manual' | 'reaction';
  actorId?: string;
}

export interface ApplyResult {
  created: number;
  resolved: number;
  reassigned: number;
  dismissed: number;
}

/**
 * The ledger's only writer. Items, audit mutations and the watermark advance
 * land in ONE transaction: either the window is fully consumed, or the
 * watermark stays put and Bull replays it. That atomicity is what makes the
 * parser retry-safe with no idempotency bookkeeping.
 */
class RadarApplier {
  async apply(params: ApplyParams): Promise<ApplyResult> {
    const { workspaceId, conversationId, watermark, scope } = params;
    const { key: scopeKey, channelId } = scope;
    // Which conversation an item belongs to, for a batch that spans several.
    // An op that already knows wins: a manual resolve-all over a DM addresses
    // items across conversations under ONE synthetic source message, so the
    // source-message map cannot tell them apart.
    const conversationFor = (op: ApplyOperation): string =>
      op.conversationId ||
      (op.sourceMessageId && params.conversationBySourceMessage?.get(op.sourceMessageId)) ||
      conversationId;
    const scopeWhere = scope.isDmChannel ? { channelId } : { conversationId };
    const result: ApplyResult = { created: 0, resolved: 0, reassigned: 0, dismissed: 0 };
    const operations = params.operations.slice(0, MAX_OPERATIONS_PER_TRANSACTION);
    if (params.operations.length > operations.length) {
      logger.warn('[RADAR-APPLIER] Operation batch truncated', {
        conversationId,
        received: params.operations.length,
        applied: operations.length,
      });
    }

    await prisma.$transaction(
      async tx => {
        // One createMany at the end: a round-trip per op overruns the budget.
        const auditRows: Prisma.ExecutionItemMutationCreateManyInput[] = [];

        // Creates run first, in their own pass, so an operation citing a create's
        // tempId can be given the real id. Ordering is NOT inherited from the
        // caller on purpose: the validator reorders on truncation, putting
        // resolves ahead of creates, and a single pass would then hit a handle
        // nothing had minted yet.
        const realIdForTempId = new Map<string, string>();
        const ordered = [
          ...operations.filter(op => op.op === 'create'),
          ...operations.filter(op => op.op !== 'create'),
        ];
        const targetId = (op: ApplyOperation): string | undefined =>
          (op.itemId && realIdForTempId.get(op.itemId)) || op.itemId;

        for (const op of ordered) {
          switch (op.op) {
            case 'create': {
              const item = await tx.executionItem.create({
                data: {
                  workspaceId,
                  conversationId: conversationFor(op),
                  channelId,
                  sourceMessageId: op.sourceMessageId,
                  title: op.title ?? '',
                  contextSummary: op.contextSummary ?? null,
                  requestedBy: op.requestedBy ?? [],
                  pendingOn: op.pendingOn ?? [],
                },
              });
              if (op.tempId) realIdForTempId.set(op.tempId, item.id);
              auditRows.push(this.auditRow(params, op, item.id, conversationFor(op)));
              result.created++;
              break;
            }
            // Guarded updateMany, not update-by-id: two concurrent resolves
            // must not both succeed. count === 0 means someone got there
            // first. The predicates also stop a mis-scoped id cross-tenant.
            case 'resolve': {
              const resolveId = targetId(op);
              const { count } = await tx.executionItem.updateMany({
                where: { id: resolveId, workspaceId, ...scopeWhere, status: 'OPEN' },
                data: { status: 'RESOLVED', resolvedAt: new Date(), pendingOn: [] },
              });
              if (count === 0) break;
              auditRows.push(this.auditRow(params, op, resolveId as string, conversationFor(op)));
              result.resolved++;
              break;
            }
            case 'reassign': {
              const reassignId = targetId(op);
              const { count } = await tx.executionItem.updateMany({
                where: { id: reassignId, workspaceId, ...scopeWhere, status: 'OPEN' },
                data: { pendingOn: op.pendingOn ?? [] },
              });
              if (count === 0) break;
              auditRows.push(this.auditRow(params, op, reassignId as string, conversationFor(op)));
              result.reassigned++;
              break;
            }
            // One person stepping away, not the item being finished.
            case 'dismiss': {
              const { actorId } = params;
              if (!actorId) break;
              // Scoped to the item's OWN conversation, not the batch's: a
              // dismiss-all over a DM card spans conversations, and a
              // batch-level id would match at most one of them and silently
              // dismiss nothing.
              //
              // One statement, not read-then-write: two simultaneous dismisses
              // would otherwise write back each other's removal.
              // Never resolves. The last holder stepping away leaves the item
              // open and ownerless, which is the schema's stated rule — it
              // stays in its requester's Waiting On, because "nobody took
              // this" is not the same claim as "this is done".
              const changed = await tx.$executeRaw`
                UPDATE "non_zero"."execution_items"
                SET "pendingOn" = array_remove("pendingOn", ${actorId}),
                    "updatedAt" = NOW()
                WHERE "id" = ${op.itemId}
                  AND "workspaceId" = ${workspaceId}
                  AND "conversationId" = ${conversationFor(op)}
                  AND "status" = 'OPEN'
                  AND ${actorId} = ANY("pendingOn")
              `;
              if (changed === 0) break;
              auditRows.push(this.auditRow(params, op, op.itemId as string, conversationFor(op)));
              result.dismissed++;
              break;
            }
            default: {
              // op is plain TEXT with no CHECK, so this union is the only
              // thing between a new verb and a silently skipped operation.
              const unhandled: never = op.op;
              throw new Error(`Unhandled execution item operation: ${String(unhandled)}`);
            }
          }
        }

        if (auditRows.length > 0) {
          await tx.executionItemMutation.createMany({ data: auditRows });
        }

        if (!watermark) return;

        await tx.executionThreadState.upsert({
          where: { conversationId: scopeKey },
          create: {
            conversationId: scopeKey,
            workspaceId,
            watermarkCreatedAt: watermark.createdAt,
            watermarkMsgId: watermark.messageId,
          },
          update: {
            watermarkCreatedAt: watermark.createdAt,
            watermarkMsgId: watermark.messageId,
            // A window that applied cleanly clears the poison counter: the
            // breaker should only trip on failures that are CONSECUTIVE.
            consecutiveFailures: 0,
          },
        });
      },
      // Prisma's 5s default is a batch-size cliff: a resolve-all over a busy
      // thread would hit P2028 and roll the whole batch back.
      { timeout: APPLY_TRANSACTION_TIMEOUT_MS },
    );

    return result;
  }

  private auditRow(
    params: ApplyParams,
    op: ParserOperation,
    itemId: string,
    conversationId: string,
  ): Prisma.ExecutionItemMutationCreateManyInput {
    return {
      workspaceId: params.workspaceId,
      conversationId,
      itemId,
      op: op.op,
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      sourceMessageId: op.sourceMessageId ?? null,
      payload: {
        title: op.title,
        contextSummary: op.contextSummary,
        requestedBy: op.requestedBy,
        pendingOn: op.pendingOn,
        reason: op.reason,
      },
    };
  }
}

export const radarApplier = new RadarApplier();
