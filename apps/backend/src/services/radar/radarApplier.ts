import type { Prisma } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import type { ParserOperation } from '@/services/radar/radarParser';
import type { RadarScope } from '@/services/radar/radarScope';
import { applyTx } from '@/bypassAcl/transactions/radarApplier';

/**
 * An operation plus, optionally, the conversation it belongs to. Manual bulk
 * actions know this per item; the parser path derives it from the source
 * message instead.
 */
export type ApplyOperation = ParserOperation & { conversationId?: string };

export const prisma = DatabaseClient.getInstance();

/** Headroom over Prisma's 5s default for a whole-thread resolve-all batch. */
export const APPLY_TRANSACTION_TIMEOUT_MS = 30_000;

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
  /** sourceMessageId -> the groups that message @mentioned, stamped onto the
   *  items it creates. Stored rather than re-derived because mention rules are
   *  evaluated on every feed read, for every reader. */
  groupsBySourceMessage?: Map<string, string[]>;
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
export class RadarApplier {
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

    await applyTx(operations, workspaceId, conversationFor, channelId, params, this, result, scopeWhere, watermark, scopeKey);

    return result;
  }

  auditRow(
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

