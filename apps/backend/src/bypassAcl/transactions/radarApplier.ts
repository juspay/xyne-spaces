import { transaction } from '../base';
import { RadarApplier } from '@/services/radar/radarApplier';
import { ApplyOperation, ApplyParams, ApplyResult, prisma, APPLY_TRANSACTION_TIMEOUT_MS } from '@/services/radar/radarApplier';
import type { Prisma } from '@prisma/client';
import { removeExecutionItemPendingOn } from '@/bypassAcl/radarServices';


export function applyTx(operations: ApplyOperation[], workspaceId: string, conversationFor: (op: ApplyOperation) => string, channelId: string, params: ApplyParams, self: RadarApplier, result: ApplyResult, scopeWhere: { channelId: string; conversationId?: undefined; } | { conversationId: string; channelId?: undefined; }, watermark: { createdAt: Date; messageId: string; } | undefined, scopeKey: string) {
  return transaction(['ExecutionItem', 'ExecutionItemMutation', 'ExecutionThreadState'], 'apply: batch item creates/updates, mutation audit rows and thread watermark must commit atomically; tx is not ACL-wrapped', prisma, 
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
                mentionedGroupIds: op.sourceMessageId
                  ? (params.groupsBySourceMessage?.get(op.sourceMessageId) ?? [])
                  : [],
              },
            });
            if (op.tempId) realIdForTempId.set(op.tempId, item.id);
            auditRows.push(self.auditRow(params, op, item.id, conversationFor(op)));
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
            auditRows.push(self.auditRow(params, op, resolveId as string, conversationFor(op)));
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
            auditRows.push(self.auditRow(params, op, reassignId as string, conversationFor(op)));
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
            const changed = await removeExecutionItemPendingOn(tx, op.itemId as string, workspaceId, conversationFor(op), actorId);
            if (changed === 0) break;
            auditRows.push(self.auditRow(params, op, op.itemId as string, conversationFor(op)));
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
}
