import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';
import { getContextOrNull } from './tenant/context';
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
  * POLICY (deliberate): audit rows never enter the caller's transaction. They
  * are written on the root client right after the intercepted op — so an audit
  * failure can never crash or poison the business transaction. Trade-off,
  * consciously accepted: if the caller's transaction later ROLLBACKS, the audit
  * entry stays (phantom entry), and an update-after-insert inside one
  * transaction reads the committed before-state (rollback/timing nuance, not
  * the wrong-diff kind the shared collector normally guards against).
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
  FormFields: 'form_fields',
  GlobalField: 'global_fields',
  UserGroup: 'user_groups',
  UserAssignmentState: 'user_assignment_states',
  UserGroupMapping: 'user_group_mappings',
  BoardComplexityScore: 'board_complexity_scores',
  UserExpertiseMapping: 'user_expertise_mappings',
  EmailChannelPreference: 'email_channel_preferences',
  ClassificationMapping: 'classification_mappings',
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

/**
 * Global-field names written by this process. A field created inside a caller's
 * open transaction isn't readable by the root client yet, so lookups fall back here.
 */
const recentGlobalFieldNames = new Map<string, string>();
const MAX_RECENT_GLOBAL_FIELD_NAMES = 500;

const rememberGlobalFieldName = (row: unknown): void => {
  const { id, fieldName } = (row ?? {}) as AuditRow;
  if (typeof id !== 'string' || typeof fieldName !== 'string') return;
  recentGlobalFieldNames.delete(id);
  recentGlobalFieldNames.set(id, fieldName);
  if (recentGlobalFieldNames.size > MAX_RECENT_GLOBAL_FIELD_NAMES) {
    const oldest = recentGlobalFieldNames.keys().next().value;
    if (oldest !== undefined) recentGlobalFieldNames.delete(oldest);
  }
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
    globalFieldsByIds: async ids => {
      const fields = (await rowsByIds('GlobalField', ids)) as unknown as { id: string; fieldName: string }[];
      const found = new Set(fields.map(field => field.id));
      for (const id of ids) {
        const fieldName = recentGlobalFieldNames.get(id);
        if (fieldName && !found.has(id)) fields.push({ id, fieldName });
      }
      return fields;
    },
    userGroupsByIds: async ids =>
      (await rowsByIds('UserGroup', ids)) as unknown as { id: string; name: string }[],
    boardIdsForFormIds: async formIds => {
      if (formIds.length === 0) return [];
      const mappings = (await prisma.formContextMapping.findMany({
        where: { formId: { in: formIds } },
      })) as { formId: string; contextId: string; contextType: string }[];
      // Non-linear boards attach forms to the transition itself.
      const transitions = (await prisma.stageTransition.findMany({
        where: { formId: { in: formIds } },
      })) as { formId: string; boardId: string }[];
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
      for (const transition of transitions) {
        const boardIds = boardIdsByFormId.get(transition.formId) ?? new Set<string>();
        boardIds.add(transition.boardId);
        boardIdsByFormId.set(transition.formId, boardIds);
      }
      return [...boardIdsByFormId].map(([formId, boardIds]) => ({
        formId,
        boardIds: [...boardIds],
      }));
    },
    formIdsForGlobalFieldIds: async globalFieldIds => {
      if (globalFieldIds.length === 0) return [];
      const rows = (await prisma.formFields.findMany({
        where: { globalFieldId: { in: globalFieldIds } },
      })) as { formId: string; globalFieldId: string }[];
      const formIdsByGlobalFieldId = new Map<string, Set<string>>();
      for (const row of rows) {
        const formIds = formIdsByGlobalFieldId.get(row.globalFieldId) ?? new Set<string>();
        formIds.add(row.formId);
        formIdsByGlobalFieldId.set(row.globalFieldId, formIds);
      }
      return [...formIdsByGlobalFieldId].map(([globalFieldId, formIds]) => ({
        globalFieldId,
        formIds: [...formIds],
      }));
    },
    memberAssignmentStates: async userGroupId => {
      const states = (await prisma.userAssignmentState.findMany({
        where: { userGroupId },
      })) as AuditRow[];
      const mappings = (await prisma.userGroupMapping.findMany({
        where: { userGroupId },
      })) as AuditRow[];
      const memberIds = new Set(mappings.map(mapping => String(mapping.userId)));
      return states.filter(state => memberIds.has(String(state.userId)));
    },
  };
}

/** Counted-set keys a write will touch, read before it runs. */
async function counterKeysBeforeWrite(params: {
  delegate: PrismaDelegate | undefined;
  operation: string;
  args: Record<string, unknown>;
  beforeRows: AuditRow[];
  groupBy: string;
}): Promise<string[]> {
  const { delegate, operation, args, beforeRows, groupBy } = params;
  const rows: unknown[] = [...beforeRows];
  if (operation === 'create' || operation === 'createMany') {
    rows.push(...(Array.isArray(args.data) ? args.data : [args.data]));
  } else if (operation === 'upsert') {
    rows.push(args.create);
  } else if (operation === 'delete' && delegate) {
    rows.push(await delegate.findUnique({ where: args.where }));
  }
  const keys = rows
    .map(row => (row as AuditRow | null | undefined)?.[groupBy])
    .filter((key): key is string => typeof key === 'string' && key.length > 0);
  return [...new Set(keys)];
}

export const auditExtension = Prisma.defineExtension(client =>
  client.$extends({
    name: 'prisma-audit-trail',
    query: {
      $allOperations: async ({ model, operation, args, query }) => {
        const table = model ? MODEL_TO_TABLE[model] : undefined;
        if (!model || !table || !operation || !AUDIT_TABLE_CONFIG[table] || !AUDITED_PRISMA_OPERATIONS.has(operation)) {
          return query(args);
        }
        return auditPrismaOperation({ client, operation, table, model, args, query });
      },
    },
  }),
);

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
  const resolution = new AuditResolution(createPrismaAuditLookup(prisma));

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

  // Counted sets are baselined before the write (a delete's returned row comes too late).
  const counters = AUDIT_TABLE_CONFIG[table]?.counters;
  if (counters) {
    try {
      const keys = await counterKeysBeforeWrite({
        delegate,
        operation,
        args,
        beforeRows,
        groupBy: counters.groupBy,
      });
      for (const key of keys) await resolution.warmCounterSnapshot(table, key, counters);
    } catch (error) {
      logger.warn('[AuditExtension] counter snapshot failed', {
        table,
        operation,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  const result = await query(args);
  if (table === 'global_fields') rememberGlobalFieldName(result);

  try {
    await emitPrismaAudit(prisma, table, operation, args, beforeRows, result, resolution);
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
  resolution: AuditResolution,
): Promise<void> {
  const resultRow =
    typeof result === 'object' && result !== null && !('count' in (result as Record<string, unknown>))
      ? (result as AuditRow)
      : null;
  const primaryKey = AUDIT_TABLE_CONFIG[table]?.primaryKey ?? 'id';
  const recordIdOf = (row: AuditRow): string => String(row[primaryKey] ?? '');

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
        writes.push({ operation: 'insert', beforeRow: null, afterRow: resultRow, recordId: recordIdOf(resultRow) });
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
          recordId: recordIdOf(row as AuditRow) || `${table}-bulk-${index}`,
        });
      });
      break;
    }
    case 'update':
      if (resultRow) {
        writes.push({ operation: 'update', beforeRow: beforeRows[0] ?? null, afterRow: resultRow, recordId: recordIdOf(resultRow) });
      }
      break;
    case 'upsert':
      if (resultRow) {
        writes.push({
          operation: beforeRows[0] ? 'update' : 'insert',
          beforeRow: beforeRows[0] ?? null,
          afterRow: resultRow,
          recordId: recordIdOf(resultRow),
        });
      }
      break;
    case 'delete':
      if (resultRow) {
        writes.push({ operation: 'delete', beforeRow: resultRow, afterRow: null, recordId: recordIdOf(resultRow) });
      }
      break;
    case 'updateMany':
      for (const row of beforeRows) {
        writes.push({
          operation: 'update',
          beforeRow: row,
          afterRow: { ...row, ...(args.data as Record<string, unknown>) },
          recordId: recordIdOf(row),
        });
      }
      break;
    case 'deleteMany':
      for (const row of beforeRows) {
        writes.push({ operation: 'delete', beforeRow: row, afterRow: null, recordId: recordIdOf(row) });
      }
      break;
  }

  if (writes.length === 0) return;

  const accumulator: AuditJobsAccumulator = { jobs: [], resolution };
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
