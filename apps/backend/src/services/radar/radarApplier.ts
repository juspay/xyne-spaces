import type { Prisma } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import type { ParserOperation } from '@/services/radar/radarParser';

const prisma = DatabaseClient.getInstance();

/** Headroom over Prisma's 5s default for a whole-thread resolve-all batch. */
const APPLY_TRANSACTION_TIMEOUT_MS = 30_000;

/** Enforced here, not only in the validator: resolve-all bypasses that path. */
const MAX_OPERATIONS_PER_TRANSACTION = 200;

export interface ApplyParams {
  workspaceId: string;
  conversationId: string;
  channelId: string;
  /** Validator-approved operations only — the applier trusts its input. */
  operations: ParserOperation[];
  /** The window's last message: items + audit + watermark commit atomically. */
  watermark: { createdAt: Date; messageId: string };
  actorType: 'llm' | 'manual';
  actorId?: string;
}

export interface ApplyResult {
  created: number;
  resolved: number;
  reassigned: number;
}

/**
 * The ledger's only writer. Items, audit mutations and the watermark advance
 * land in ONE transaction: either the window is fully consumed, or the
 * watermark stays put and Bull replays it. That atomicity is what makes the
 * parser retry-safe with no idempotency bookkeeping.
 */
class RadarApplier {
  async apply(params: ApplyParams): Promise<ApplyResult> {
    const { workspaceId, conversationId, channelId, watermark } = params;
    const result: ApplyResult = { created: 0, resolved: 0, reassigned: 0 };
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

        for (const op of operations) {
          switch (op.op) {
            case 'create': {
              const item = await tx.executionItem.create({
                data: {
                  workspaceId,
                  conversationId,
                  channelId,
                  sourceMessageId: op.sourceMessageId,
                  title: op.title ?? '',
                  contextSummary: op.contextSummary ?? null,
                  requestedBy: op.requestedBy ?? [],
                  pendingOn: op.pendingOn ?? [],
                },
              });
              auditRows.push(this.auditRow(params, op, item.id));
              result.created++;
              break;
            }
            // Guarded updateMany, not update-by-id: two concurrent resolves
            // must not both succeed. count === 0 means someone got there
            // first. The predicates also stop a mis-scoped id cross-tenant.
            case 'resolve': {
              const { count } = await tx.executionItem.updateMany({
                where: { id: op.itemId, workspaceId, conversationId, status: 'OPEN' },
                data: { status: 'RESOLVED', resolvedAt: new Date(), pendingOn: [] },
              });
              if (count === 0) break;
              auditRows.push(this.auditRow(params, op, op.itemId as string));
              result.resolved++;
              break;
            }
            case 'reassign': {
              const { count } = await tx.executionItem.updateMany({
                where: { id: op.itemId, workspaceId, conversationId, status: 'OPEN' },
                data: { pendingOn: op.pendingOn ?? [] },
              });
              if (count === 0) break;
              auditRows.push(this.auditRow(params, op, op.itemId as string));
              result.reassigned++;
              break;
            }
          }
        }

        if (auditRows.length > 0) {
          await tx.executionItemMutation.createMany({ data: auditRows });
        }

        await tx.executionThreadState.upsert({
          where: { conversationId },
          create: {
            conversationId,
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
  ): Prisma.ExecutionItemMutationCreateManyInput {
    return {
      workspaceId: params.workspaceId,
      conversationId: params.conversationId,
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
