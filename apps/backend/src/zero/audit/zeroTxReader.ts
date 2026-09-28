import type { Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { zql } from '../queries';
import { AUDIT_TABLE_CONFIG } from './config';
import { collectTableAudit } from './collector';
import { AuditResolution } from './resolution';
import type {
  AuditJobsAccumulator,
  AuditLookup,
  AuditOperation,
  AuditRow,
  AuditStageRow,
  AuditTransitionRow,
} from './types';

/**
 * Zero-side audit plumbing: lookups run on the mutation's own transaction and
 * the accumulator is created once per mutator execution so name resolution is
 * memoized across every tx.mutate call of the save.
 */

type AnyBuilder = {
  where: (column: string, operatorOrValue: string, value?: unknown) => {
    one: () => unknown;
  };
};

const builderFor = (table: string): AnyBuilder | undefined =>
  (zql as unknown as Record<string, AnyBuilder>)[table];

/** Read a single row by id from any table (used to capture before-state). */
export async function readZeroAuditRow(
  tx: Transaction<Schema>,
  table: string,
  recordId: string,
): Promise<AuditRow | null> {
  const builder = builderFor(table);
  if (!builder) return null;
  const row = (await tx.run(builder.where('id', recordId).one() as never)) as AuditRow | undefined;
  return row ?? null;
}

export function createZeroAuditLookup(tx: Transaction<Schema>): AuditLookup {
  const rowsByIds = async (table: string, ids: string[]): Promise<AuditRow[]> => {
    if (ids.length === 0) return [];
    const builder = builderFor(table);
    if (!builder) return [];
    return (await tx.run(
      builder.where('id', 'IN', ids) as never,
    )) as AuditRow[];
  };

  return {
    stagesByIds: async ids =>
      (await rowsByIds('stages', ids)) as unknown as AuditStageRow[],
    transitionsByIds: async ids =>
      (await rowsByIds('stage_transitions', ids)) as unknown as AuditTransitionRow[],
    boardsByIds: async ids =>
      (await rowsByIds('boards', ids)) as unknown as { id: string; name: string }[],
    usersByIds: async ids =>
      (await rowsByIds('users', ids)) as unknown as {
        id: string;
        displayName?: string | null;
        name?: string | null;
      }[],
    rolesByIds: async ids =>
      (await rowsByIds('roles', ids)) as unknown as { id: string; name: string }[],
    formsByIds: async ids =>
      (await rowsByIds('forms', ids)) as unknown as { id: string; formName: string }[],
    globalFieldsByIds: async ids =>
      (await rowsByIds('global_fields', ids)) as unknown as { id: string; fieldName: string }[],
    boardIdsForFormIds: async formIds => {
      if (formIds.length === 0) return [];
      const mappingBuilder = (zql as unknown as Record<string, AnyBuilder>)['forms_context_mapping'];
      if (!mappingBuilder) return [];
      const rows = (await tx.run(
        mappingBuilder.where('formId', 'IN', formIds) as never,
      )) as { formId: string; contextId: string; contextType: string }[];
      const stageIds = rows
        .filter(mapping => mapping.contextType === 'STAGE')
        .map(mapping => mapping.contextId);
      const stages = (await rowsByIds('stages', stageIds)) as unknown as AuditStageRow[];
      const stageBoardById = new Map(stages.map(stage => [stage.id, stage.boardId]));

      const boardIdsByFormId = new Map<string, Set<string>>();
      for (const mapping of rows) {
        const boardId =
          mapping.contextType === 'BOARD'
            ? mapping.contextId
            : stageBoardById.get(mapping.contextId);
        if (!boardId) continue;
        const set = boardIdsByFormId.get(mapping.formId) ?? new Set<string>();
        set.add(boardId);
        boardIdsByFormId.set(mapping.formId, set);
      }
      return [...boardIdsByFormId].map(([formId, boardIds]) => ({
        formId,
        boardIds: [...boardIds],
      }));
    },
  };
}

/** Create the per-save accumulator bound to a Zero transaction. */
/**
 * Build the per-mutation audit accumulator. Prewarms the actor's user row while
 * the transaction is open — the flush runs post-commit, so its actor lookup
 * could otherwise hit the released tx connection. Failure must never fail the
 * business mutation (audit policy): on error the actor is marked missing so the
 * flush reads the cache and records actorUserId=null rather than querying
 * the released connection lazily.
 */
export async function createZeroAuditJobs(
  tx: Transaction<Schema>,
  actorUserId: string,
): Promise<AuditJobsAccumulator> {
  const resolution = new AuditResolution(createZeroAuditLookup(tx));
  try {
    await resolution.warmUsers([actorUserId]);
  } catch {
    resolution.markActorMissing(actorUserId);
  }
  return { jobs: [], resolution };
}

/**
 * Collect the audit drafts for one intercepted tx.mutate call. Must run BEFORE the
 * write executes (before-state read); drafts land in `staging`, which the caller
 * publishes to the real accumulator only after the write succeeds.
 */
export async function collectZeroAuditOperation(params: {
  table: string;
  operation: AuditOperation;
  args: unknown;
  tx: Transaction<Schema>;
  accumulator: AuditJobsAccumulator;
  staging: AuditJobsAccumulator;
}): Promise<void> {
  if (!AUDIT_TABLE_CONFIG[params.table]) return;
  const rowArgs = (params.args ?? {}) as AuditRow;
  const recordId = String(rowArgs.id ?? '');
  if (!recordId) return;

  let beforeRow: AuditRow | null = null;
  if (params.operation !== 'insert') {
    beforeRow = await readZeroAuditRow(params.tx, params.table, recordId);
  }
  const afterRow =
    params.operation === 'delete'
      ? null
      : ({ ...(beforeRow ?? {}), ...rowArgs } as AuditRow);

  await collectTableAudit({
    table: params.table,
    operation: params.operation,
    beforeRow,
    afterRow,
    recordId,
    accumulator: params.staging,
  });
}
