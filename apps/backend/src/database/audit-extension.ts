import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';
import { getContextOrNull } from './tenant/context';
import { getTransactionClient, watchTransactionFn } from './tenant/tx-context';
import {
  AUDIT_TABLE_CONFIG,
  collectTableAudit,
  groupAuditJobs,
} from '../zero/audit';
import { AuditResolution } from '../zero/audit/resolution';
import type {
  AuditJobsAccumulator,
  AuditLookup,
  AuditOperation,
  AuditRow,
  AuditStageRow,
  AuditTransitionRow,
} from '../zero/audit/types';

/**
 * Prisma-side audit interceptor. Writes to whitelisted tables made through the
 * shared `db` client (HTTP controllers, services, background jobs) are diffed
 * and recorded with the same AUDIT_TABLE_CONFIG the Zero wrapper uses — no
 * per-caller audit code.
 *
 * Audit rows are persisted right after the intercepted write succeeds. They are
 * therefore not strictly same-transaction with a surrounding $transaction
 * (unlike the Zero path, which flushes on the mutation's own transaction).
 */

const MODEL_TO_TABLE: Record<string, string> = {
  Board: 'boards',
  Stage: 'stages',
  StageTransition: 'stage_transitions',
  StageApprover: 'stage_approvers',
  StagePrStatusMapping: 'stage_pr_status_mappings',
  BoardSlaPolicy: 'board_sla_policies',
  FormContextMapping: 'forms_context_mapping',
  Form: 'forms',
  FormField: 'form_fields',
  UserGroup: 'user_groups',
  UserAssignmentState: 'user_assignment_states',
  UserGroupMapping: 'user_group_mappings',
  BoardComplexityScore: 'board_complexity_scores',
  UserExpertiseMapping: 'user_expertise_mappings',
};

const AUDITED_PRISMA_OPERATIONS = new Set([
  'create',
  'update',
  'upsert',
  'delete',
  'createMany',
  'updateMany',
  'deleteMany',
]);

type PrismaDelegate = {
  findUnique(args: { where: unknown }): Promise<unknown>;
  findMany(args: { where: unknown }): Promise<unknown[]>;
};

type PrismaAuditClient = Record<string, PrismaDelegate> & {
  auditLog: { create(args: { data: unknown }): Promise<unknown> };
};

const prismaDelegateName = (model: string): string =>
  model.charAt(0).toLowerCase() + model.slice(1);

const asAuditClient = (client: unknown): PrismaAuditClient => client as PrismaAuditClient;

const firstWorkspaceId = (rows: { beforeRow: AuditRow | null; afterRow: AuditRow | null }[]): string | null => {
  for (const { beforeRow, afterRow } of rows) {
    const workspaceId = beforeRow?.workspaceId ?? afterRow?.workspaceId;
    if (typeof workspaceId === 'string' && workspaceId.length > 0) return workspaceId;
  }
  return null;
};

function createPrismaAuditLookup(prisma: PrismaAuditClient): AuditLookup {
  const rowsByIds = async (model: string, ids: string[]): Promise<AuditRow[]> => {
    if (ids.length === 0) return [];
    const delegate = prisma[prismaDelegateName(model)];
    if (!delegate) return [];
    return (await delegate.findMany({ where: { id: { in: ids } } })) as AuditRow[];
  };

  return {
    stagesByIds: async ids => (await rowsByIds('Stage', ids)) as unknown as AuditStageRow[],
    transitionsByIds: async ids =>
      (await rowsByIds('StageTransition', ids)) as unknown as AuditTransitionRow[],
    boardsByIds: async ids =>
      (await rowsByIds('Board', ids)) as unknown as { id: string; name: string }[],
    usersByIds: async ids =>
      (await rowsByIds('User', ids)) as unknown as {
        id: string;
        displayName?: string | null;
        name?: string | null;
      }[],
    rolesByIds: async ids =>
      (await rowsByIds('Role', ids)) as unknown as { id: string; name: string }[],
    formsByIds: async ids =>
      (await rowsByIds('Form', ids)) as unknown as { id: string; formName: string }[],
    globalFieldsByIds: async ids =>
      (await rowsByIds('GlobalField', ids)) as unknown as { id: string; fieldName: string }[],
    boardIdsForFormIds: async formIds => {
      if (formIds.length === 0) return [];
      const mappings = (await prisma.formContextMapping.findMany({
        where: { formId: { in: formIds } },
      })) as { formId: string; contextId: string; contextType: string }[];
      const stageIds = mappings
        .filter(mapping => mapping.contextType === 'STAGE')
        .map(mapping => mapping.contextId);
      const stages =
        stageIds.length > 0
          ? ((await prisma.stage.findMany({ where: { id: { in: stageIds } } })) as AuditStageRow[])
          : [];
      const stageBoardById = new Map(stages.map(stage => [stage.id, stage.boardId]));

      const boardIdsByFormId = new Map<string, Set<string>>();
      for (const mapping of mappings) {
        const boardId =
          mapping.contextType === 'BOARD'
            ? mapping.contextId
            : stageBoardById.get(mapping.contextId);
        if (!boardId) continue;
        const boardIds = boardIdsByFormId.get(mapping.formId) ?? new Set<string>();
        boardIds.add(boardId);
        boardIdsByFormId.set(mapping.formId, boardIds);
      }
      return [...boardIdsByFormId].map(([formId, boardIds]) => ({
        formId,
        boardIds: [...boardIds],
      }));
    },
  };
}

export const auditExtension = Prisma.defineExtension(client => {
  let runTransaction: (...args: unknown[]) => unknown;
  const extended = client.$extends({
    name: 'prisma-audit-trail',
    query: {
      $allOperations: async ({ model, operation, args, query }) => {
        const table = model ? MODEL_TO_TABLE[model] : undefined;
        if (!model || !table || !operation || !AUDIT_TABLE_CONFIG[table] || !AUDITED_PRISMA_OPERATIONS.has(operation)) {
          return query(args);
        }
        // Inside an interactive transaction, run on its client so the before-read
        // sees rows created earlier in it and the audit insert rolls back with it.
        const auditClient = (getTransactionClient() ?? client) as PrismaAuditClient;
        return auditPrismaOperation({ client: auditClient, operation, table, model, args, query });
      },
    },
    client: {
      $transaction(...args: unknown[]) {
        if (typeof args[0] === 'function') {
          return runTransaction(
            watchTransactionFn(args[0] as (tx: unknown) => unknown),
            ...args.slice(1),
          );
        }
        return runTransaction(...args);
      },
    },
  });
  runTransaction = (extended.$transaction as (...args: unknown[]) => unknown).bind(extended);
  return extended;
});

async function auditPrismaOperation(params: {
  client: unknown;
  operation: string;
  table: string;
  model: string;
  args: Record<string, unknown>;
  query: (args: unknown) => Promise<unknown>;
}): Promise<unknown> {
  const { client, operation, table, model, args, query } = params;
  const prisma = asAuditClient(client);
  const delegate = prisma[prismaDelegateName(model)];

  // Before-state for the diff. `delete` returns the removed row itself, so it
  // needs no pre-read; update/upsert/updateMany/deleteMany do.
  let beforeRows: AuditRow[] = [];
  if (
    delegate &&
    (operation === 'update' || operation === 'upsert' || operation === 'updateMany' || operation === 'deleteMany')
  ) {
    try {
      if (operation === 'update' || operation === 'upsert') {
        const row = await delegate.findUnique({ where: args.where });
        if (row) beforeRows = [row as AuditRow];
      } else {
        beforeRows = (await delegate.findMany({ where: args.where })) as AuditRow[];
      }
    } catch (error) {
      logger.warn('[AuditExtension] before-state read failed', {
        table,
        operation,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  const result = await query(args);

  try {
    await emitPrismaAudit(prisma, table, operation, args, beforeRows, result);
  } catch (error) {
    logger.error('[AuditExtension] failed to persist audit rows', {
      table,
      operation,
      error: error instanceof Error ? error.message : error,
    });
  }
  return result;
}

async function emitPrismaAudit(
  prisma: PrismaAuditClient,
  table: string,
  operation: string,
  args: Record<string, unknown>,
  beforeRows: AuditRow[],
  result: unknown,
): Promise<void> {
  const resultRow =
    typeof result === 'object' && result !== null && !('count' in (result as Record<string, unknown>))
      ? (result as AuditRow)
      : null;

  interface AuditedWrite {
    operation: AuditOperation;
    beforeRow: AuditRow | null;
    afterRow: AuditRow | null;
    recordId: string;
  }

  const writes: AuditedWrite[] = [];
  switch (operation) {
    case 'create':
      if (resultRow) {
        writes.push({ operation: 'insert', beforeRow: null, afterRow: resultRow, recordId: String(resultRow.id ?? '') });
      }
      break;
    case 'createMany': {
      const data = Array.isArray(args.data) ? args.data : [args.data];
      data.forEach((row, index) => {
        // Bulk-created rows may carry server-generated ids the args don't know;
        // a synthetic recordId keeps the change row traceable to the write.
        writes.push({
          operation: 'insert',
          beforeRow: null,
          afterRow: row as AuditRow,
          recordId: String((row as AuditRow).id ?? `${table}-bulk-${index}`),
        });
      });
      break;
    }
    case 'update':
      if (resultRow) {
        writes.push({ operation: 'update', beforeRow: beforeRows[0] ?? null, afterRow: resultRow, recordId: String(resultRow.id ?? '') });
      }
      break;
    case 'upsert':
      if (resultRow) {
        writes.push({
          operation: beforeRows[0] ? 'update' : 'insert',
          beforeRow: beforeRows[0] ?? null,
          afterRow: resultRow,
          recordId: String(resultRow.id ?? ''),
        });
      }
      break;
    case 'delete':
      if (resultRow) {
        writes.push({ operation: 'delete', beforeRow: resultRow, afterRow: null, recordId: String(resultRow.id ?? '') });
      }
      break;
    case 'updateMany':
      for (const row of beforeRows) {
        writes.push({
          operation: 'update',
          beforeRow: row,
          afterRow: { ...row, ...(args.data as Record<string, unknown>) },
          recordId: String(row.id ?? ''),
        });
      }
      break;
    case 'deleteMany':
      for (const row of beforeRows) {
        writes.push({ operation: 'delete', beforeRow: row, afterRow: null, recordId: String(row.id ?? '') });
      }
      break;
  }

  if (writes.length === 0) return;

  const accumulator: AuditJobsAccumulator = {
    jobs: [],
    resolution: new AuditResolution(createPrismaAuditLookup(prisma)),
  };
  for (const write of writes) {
    await collectTableAudit({
      table,
      operation: write.operation,
      beforeRow: write.beforeRow,
      afterRow: write.afterRow,
      recordId: write.recordId,
      accumulator,
    });
  }
  if (accumulator.jobs.length === 0) return;

  const groups = groupAuditJobs(accumulator);
  if (groups.length === 0) return;

  const tenantCtx = getContextOrNull();
  const actorUserId = tenantCtx?.actor === 'user' ? tenantCtx.userId : null;
  const workspaceId = tenantCtx?.workspaceId ?? firstWorkspaceId(writes);
  if (!workspaceId) return;

  for (const group of groups) {
    if (group.drafts.length === 0) continue;
    await prisma.auditLog.create({
      data: {
        id: uuidv4(),
        workspaceId,
        actorUserId,
        entityType: group.scope.entityType,
        entityId: group.scope.entityId,
        changes: {
          create: group.drafts.map(draft => ({
            id: uuidv4(),
            workspaceId,
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
