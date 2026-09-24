import { AuditAction, rollupAuditAction, type AuditChangeDraft } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import type { Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { AUDIT_ENTITY_META } from './config';
import type { AuditJobsAccumulator, AuditScope } from './types';

/**
 * Flush the per-save accumulator: drafts are grouped by (entityType, entityId)
 * so one save produces one parent audit log row per affected scope, with every
 * field-level change as a child row — written on the same transaction as the
 * mutations being audited.
 */

interface AuditJobGroup {
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
  return [...groups.values()];
}

export function buildAuditSummary(group: AuditJobGroup): string {
  const meta = AUDIT_ENTITY_META[group.scope.entityType] ?? { rootTable: '', noun: 'configuration' };
  const action = rollupAuditAction(group.drafts);
  const verb =
    action === AuditAction.CREATE ? 'Created' : action === AuditAction.DELETE ? 'Deleted' : 'Updated';
  const rootDraft = meta.rootTable
    ? group.drafts.find(draft => draft.tableName === meta.rootTable)
    : undefined;
  const scopeName = rootDraft?.targetName ?? group.drafts[0]?.targetName ?? '';
  return `${verb} ${meta.noun}${scopeName ? ` for ${scopeName}` : ''}`;
}

export async function flushAuditTrail(
  tx: Transaction<Schema>,
  ctx: { userId: string; workspaceId: string },
  accumulator: AuditJobsAccumulator,
): Promise<void> {
  const groups = groupAuditJobs(accumulator);
  if (groups.length === 0) return;

  const createdAt = Date.now();
  const actorUserId = await accumulator.resolution.resolveActorUserId(ctx.userId);
  for (const group of groups) {
    if (group.drafts.length === 0) continue;

    const auditLogId = uuidv4();
    await tx.mutate.audit_logs.insert({
      workspaceId: ctx.workspaceId,
      id: auditLogId,
      actorUserId,
      action: rollupAuditAction(group.drafts),
      entityType: group.scope.entityType,
      entityId: group.scope.entityId,
      summary: buildAuditSummary(group),
      createdAt,
    });

    for (const draft of group.drafts) {
      await tx.mutate.audit_log_changes.insert({
        workspaceId: ctx.workspaceId,
        id: uuidv4(),
        auditLogId,
        action: draft.action,
        tableName: draft.tableName,
        recordId: draft.recordId,
        targetName: draft.targetName,
        field: draft.field,
        oldValue: draft.oldValue,
        newValue: draft.newValue,
        createdAt,
      });
    }
  }
}
