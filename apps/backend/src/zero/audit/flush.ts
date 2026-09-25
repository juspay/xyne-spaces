import { v4 as uuidv4 } from 'uuid';
import { AuditAction, type AuditChangeDraft } from '@xyne/shared';
import type { AuditJobsAccumulator, AuditScope } from './types';

/**
 * Flush the per-save accumulator: drafts are grouped by (entityType, entityId)
 * so one save produces one parent audit log row per affected scope, with every
 * field-level change as a child row.
 *
 * Written via the shared Prisma client — audit tables live in the non_zero
 * schema and are not part of the Zero graph, so this is a separate commit from
 * the mutation it describes; callers run it after the mutation succeeds.
 */

interface AuditLogDelegate {
  create(args: { data: unknown }): Promise<unknown>;
}

export interface AuditDbWriter {
  auditLog: AuditLogDelegate;
}

export interface AuditJobGroup {
  scope: AuditScope;
  drafts: AuditChangeDraft[];
}

export function groupAuditJobs(accumulator: AuditJobsAccumulator): AuditJobGroup[] {
  const groups = new Map<string, AuditJobGroup>();
  for (const job of accumulator.jobs) {
    const key = `${job.scope.entityType}:${job.scope.entityId}`;
    const group = groups.get(key) ?? { scope: job.scope, drafts: [] };
    group.drafts.push(...job.drafts);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.drafts = reconcileReplacePairs(group.drafts);
  }
  return [...groups.values()];
}

/**
 * Mutators frequently replace child rows (delete + insert) instead of updating
 * them, e.g. form mappings / stage approvers on board save. Within one save,
 * collapse each DELETE/CREATE pair sharing (table, natural key, field) into a
 * single UPDATE — or drop both when the replacement is identical, which is the
 * common case. The natural key comes from the table config's reconcileKey when
 * rows get fresh ids on replacement, else the recordId itself.
 */
function reconcileReplacePairs(drafts: AuditChangeDraft[]): AuditChangeDraft[] {
  const pairKeysByChangeKey = new Map<string, { deleteIndex?: number; createIndex?: number }>();
  for (const [index, draft] of drafts.entries()) {
    if (draft.action !== AuditAction.CREATE && draft.action !== AuditAction.DELETE) continue;
    const key = `${draft.tableName}|${draft.pairKey ?? draft.recordId}|${draft.field}`;
    const pair = pairKeysByChangeKey.get(key) ?? {};
    if (draft.action === AuditAction.DELETE) pair.deleteIndex = index;
    else pair.createIndex = index;
    pairKeysByChangeKey.set(key, pair);
  }

  const droppedIndexes = new Set<number>();
  for (const pair of pairKeysByChangeKey.values()) {
    if (pair.deleteIndex === undefined || pair.createIndex === undefined) continue;
    const deletedDraft = drafts[pair.deleteIndex]!;
    const createdDraft = drafts[pair.createIndex]!;
    droppedIndexes.add(pair.deleteIndex);
    if (deletedDraft.oldValue === createdDraft.newValue) {
      droppedIndexes.add(pair.createIndex);
    } else {
      createdDraft.action = AuditAction.UPDATE;
      createdDraft.oldValue = deletedDraft.oldValue;
    }
  }
  return drafts.filter((_, index) => !droppedIndexes.has(index));
}

export async function flushAuditTrail(
  db: AuditDbWriter,
  ctx: { userId: string; workspaceId: string },
  accumulator: AuditJobsAccumulator,
): Promise<void> {
  const groups = groupAuditJobs(accumulator);
  if (groups.length === 0) return;

  const actorUserId = await accumulator.resolution.resolveActorUserId(ctx.userId);
  for (const group of groups) {
    if (group.drafts.length === 0) continue;

    await db.auditLog.create({
      data: {
        id: uuidv4(),
        workspaceId: ctx.workspaceId,
        actorUserId,
        entityType: group.scope.entityType,
        entityId: group.scope.entityId,
        changes: {
          create: group.drafts.map(draft => ({
            id: uuidv4(),
            workspaceId: ctx.workspaceId,
            action: draft.action,
            tableName: draft.tableName,
            recordId: draft.recordId,
            targetName: draft.targetName,
            field: draft.field,
            oldValue: draft.oldValue,
            newValue: draft.newValue,
          })),
        },
      },
    });
  }
}
