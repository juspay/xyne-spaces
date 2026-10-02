import {
  AuditAction,
  diffAuditChanges,
  diffJsonAuditChanges,
  type AuditChangeDraft,
} from '@xyne/shared';
import { AUDIT_TABLE_CONFIG } from './config';
import { rowString, type AuditResolution } from './resolution';
import type {
  AuditCounterDelta,
  AuditJobsAccumulator,
  AuditOperation,
  AuditRow,
  AuditTableConfig,
} from './types';

/**
 * Table-agnostic audit collection. Given the before/after state of one mutated
 * row, produces the field-level change drafts and pushes them onto the
 * accumulator under the scope the table config resolves. Called by the Zero
 * wrapper and the Prisma extension alike.
 */

const GLOBAL_IGNORE_FIELDS = new Set([
  'id',
  'workspaceId',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
]);

/** Empty containers and null are treated as one "no value" state so [] ↔ null flips don't produce noise. */
const isEmptyValue = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && value !== null && Object.keys(value).length === 0);

const createDefaultsRow = (
  defaults: Record<string, unknown> | undefined,
): AuditRow | null => (defaults ? { ...defaults } : null);

const formatField = (
  value: unknown,
  formatter: ((value: unknown, res: AuditResolution) => string | null) | undefined,
  res: AuditResolution,
): string | null =>
  formatter
    ? formatter(value, res)
    : value === null || value === undefined
      ? null
      : String(value);

/**
 * Filter ignored fields, normalize empty containers to null and apply per-field
 * formatters so the diff compares the values the audit trail should store.
 */
const prepareRow = (
  row: AuditRow | null,
  ignore: Set<string>,
  formatters: Record<string, (value: unknown, res: AuditResolution) => string | null>,
  res: AuditResolution,
): Record<string, unknown> | null => {
  if (!row) return null;
  const prepared: Record<string, unknown> = {};
  for (const [field, rawValue] of Object.entries(row)) {
    if (ignore.has(field)) continue;
    const formatter = formatters[field];
    if (formatter) {
      prepared[field] = formatter(rawValue, res);
    } else {
      prepared[field] = isEmptyValue(rawValue) ? null : rawValue;
    }
  }
  return prepared;
};

const buildDeleteDraft = (params: {
  table: string;
  recordId: string;
  targetName: string;
  beforeRow: AuditRow | null;
  config: AuditTableConfig;
  res: AuditResolution;
}): AuditChangeDraft | null => {
  const { table, recordId, targetName, beforeRow, config, res } = params;
  const summary = config.deleteSummary ?? { field: 'name' };
  const oldValue = summary.value
    ? summary.value(beforeRow ?? {}, res)
    : formatField(beforeRow?.[summary.field], config.fieldFormatters?.[summary.field], res);
  if (oldValue === null || oldValue === undefined || oldValue === '') return null;
  return {
    action: AuditAction.DELETE,
    tableName: table,
    recordId,
    targetName,
    field: summary.field,
    oldValue: String(oldValue),
    newValue: null,
  };
};

/** How a written row moves its table's counted set; undefined when it doesn't. */
const counterDeltaOf = (
  table: string,
  config: AuditTableConfig,
  action: AuditAction,
  beforeRow: AuditRow | null,
  afterRow: AuditRow | null,
): AuditCounterDelta | undefined => {
  const counters = config.counters;
  if (!counters) return undefined;
  const key = rowString(afterRow ?? beforeRow ?? {}, counters.groupBy);
  if (!key) return undefined;

  // Inserts may omit defaulted columns; count them at their create defaults.
  const after =
    afterRow && action === AuditAction.CREATE ? { ...config.createDefaults, ...afterRow } : afterRow;
  const delta: Record<string, number> = {};
  let moved = false;
  for (const [field, counts] of Object.entries(counters.fields)) {
    delta[field] = (after && counts(after) ? 1 : 0) - (beforeRow && counts(beforeRow) ? 1 : 0);
    if (delta[field] !== 0) moved = true;
  }
  return moved ? { table, key, delta } : undefined;
};

export async function collectTableAudit(params: {
  table: string;
  operation: AuditOperation;
  beforeRow: AuditRow | null;
  afterRow: AuditRow | null;
  recordId: string;
  accumulator: AuditJobsAccumulator;
}): Promise<void> {
  const config = AUDIT_TABLE_CONFIG[params.table];
  if (!config) return;

  const { operation, beforeRow, afterRow, recordId, accumulator } = params;
  if (!recordId) return;

  const action: AuditAction =
    operation === 'delete'
      ? AuditAction.DELETE
      : beforeRow
        ? AuditAction.UPDATE
        : AuditAction.CREATE;

  const row = afterRow ?? beforeRow ?? {};

  await config.prewarm?.(beforeRow, afterRow, accumulator.resolution);
  const targetName = await config.resolveTargetName(row, accumulator.resolution);

  // jsonFields columns are diffed structurally below; leaving them in the plain
  // row pass would stringify the whole blob — key-order-sensitive JSON.stringify
  // even fabricates phantom changes on identical content.
  const ignore = new Set([
    ...GLOBAL_IGNORE_FIELDS,
    ...(config.primaryKey ? [config.primaryKey] : []),
    ...(config.ignoreFields ?? []),
    ...Object.keys(config.jsonFields ?? {}),
  ]);
  const formatters = config.fieldFormatters ?? {};
  const drafts: AuditChangeDraft[] = [];

  if (action === AuditAction.DELETE) {
    const deleteDraft = buildDeleteDraft({
      table: params.table,
      recordId,
      targetName,
      beforeRow,
      config,
      res: accumulator.resolution,
    });
    if (deleteDraft) drafts.push(deleteDraft);
  } else {
    const baselineRow =
      action === AuditAction.CREATE ? createDefaultsRow(config.createDefaults) : beforeRow;
    const preparedBefore = prepareRow(baselineRow, ignore, formatters, accumulator.resolution);
    const preparedAfter = prepareRow(afterRow, ignore, formatters, accumulator.resolution);

    drafts.push(
      ...diffAuditChanges({
        action,
        tableName: params.table,
        recordId,
        targetName,
        before: preparedBefore,
        after: preparedAfter,
      }),
    );

    for (const [column, formatter] of Object.entries(config.jsonFields ?? {})) {
      drafts.push(
        ...diffJsonAuditChanges({
          tableName: params.table,
          recordId,
          targetName,
          fieldPrefix: column,
          before: (beforeRow?.[column] as Record<string, unknown> | null) ?? null,
          after: (afterRow?.[column] as Record<string, unknown> | null) ?? null,
          formatValue: (key, value) => formatter(key, value, accumulator.resolution),
          ...(config.deepJsonFields?.[column] && { deepKeys: config.deepJsonFields[column] }),
        }),
      );
    }
  }

  // A row can move a counted set without a visible field change (e.g. a member
  // added at the default flags), so its job is kept for the totals alone.
  const counterDelta = counterDeltaOf(params.table, config, action, beforeRow, afterRow);
  if (drafts.length === 0 && !counterDelta) return;

  // Fingerprint replacements (delete + reinsert with a new id) so the flush can
  // pair and merge them — see reconcileReplacePairs.
  const pairKey = config.reconcileKey?.(row);
  if (pairKey) {
    for (const draft of drafts) draft.pairKey = pairKey;
  }

  const scopeOrScopes = await config.resolveScope(row, accumulator.resolution);
  if (!scopeOrScopes) return;
  const scopes = Array.isArray(scopeOrScopes) ? scopeOrScopes : [scopeOrScopes];
  for (const scope of scopes) {
    if (!scope.entityId) continue;
    accumulator.jobs.push({ scope, drafts, ...(counterDelta && { counterDelta }) });
  }
}
