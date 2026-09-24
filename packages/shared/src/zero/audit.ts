import { AuditAction } from './types';

/**
 * Generic audit-trail helpers.
 *
 * The audit trail is generalized: any write path can record its changes by
 * diffing the before/after state of each mutated row. `diffAuditChanges`
 * produces the field-level change rows; the caller inserts them (plus one
 * parent audit log row) via Prisma. Reads happen over REST — the payload
 * shapes below are the GET /api/audit-logs contract.
 */

/** GET /api/audit-logs — one change row. */
export interface AuditLogChange {
  id: string;
  action: AuditAction;
  tableName: string;
  recordId: string;
  targetName: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: number;
}

/** GET /api/audit-logs — one parent entry with its actor and change rows. */
export interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  createdAt: number;
  actor: {
    id: string;
    name: string;
    email: string;
    picture: string | null;
  } | null;
  changes: AuditLogChange[];
}

/** GET /api/audit-logs — keyset-paginated response envelope. */
export interface AuditLogPage {
  logs: AuditLogEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AuditChangeDraft {
  /** Action performed on the record (INSERT / UPDATE / DELETE). */
  action: AuditAction;
  /** Table that was mutated, e.g. user_assignment_states. */
  tableName: string;
  /** PK of the mutated row. */
  recordId: string;
  /** Human label of the changed row (the audit target), snapshotted at write time. */
  targetName: string;
  /** Changed field name, e.g. onCall. */
  field: string;
  /** Stringified previous value; null for INSERT. */
  oldValue: string | null;
  /** Stringified new value; null for DELETE. */
  newValue: string | null;
  /**
   * Internal reconciliation fingerprint (table natural key) — NEVER persisted:
   * lets the flush pair a DELETE with the CREATE of a deleted+reinserted row
   * whose id changed, so replacements collapse into UPDATEs or no-ops.
   */
  pairKey?: string;
}

/** Stringify an audit value: booleans/numbers as-is, arrays/objects as JSON. */
export function stringifyAuditValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Diff two versions of a record and produce one AuditChangeDraft per changed field.
 * `before` is null for INSERT (all provided fields are new), `after` is null for
 * DELETE (all provided fields are old). Fields set to undefined in `after` are ignored.
 */
export function diffAuditChanges(params: {
  action: AuditAction;
  tableName: string;
  recordId: string;
  targetName: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}): AuditChangeDraft[] {
  const { action, tableName, recordId, targetName, before, after } = params;
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const drafts: AuditChangeDraft[] = [];

  for (const field of fields) {
    if (after && after[field] === undefined) continue;
    const oldRaw = before ? before[field] : undefined;
    const newRaw = after ? after[field] : undefined;
    const oldValue = stringifyAuditValue(oldRaw);
    const newValue = stringifyAuditValue(newRaw);
    if (oldValue === newValue) continue;

    drafts.push({
      action,
      tableName,
      recordId,
      targetName,
      field,
      oldValue,
      newValue,
    });
  }

  return drafts;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Recursively diff two JSON subtrees, emitting one draft per changed leaf with
 * the full dot path as the field (e.g. `metadata.ticketFormConfig.todo.enabled`).
 * Unchanged leaves produce no drafts.
 */
function collectDeepJsonDiff(params: {
  tableName: string;
  recordId: string;
  targetName: string;
  before: unknown;
  after: unknown;
  fieldPath: string;
  drafts: AuditChangeDraft[];
}): void {
  const { tableName, recordId, targetName, before, after, fieldPath, drafts } = params;
  if (isPlainObject(before) || isPlainObject(after)) {
    const beforeRecord = isPlainObject(before) ? before : {};
    const afterRecord = isPlainObject(after) ? after : {};
    const leafKeys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
    for (const leafKey of leafKeys) {
      collectDeepJsonDiff({
        tableName,
        recordId,
        targetName,
        before: beforeRecord[leafKey],
        after: afterRecord[leafKey],
        fieldPath: `${fieldPath}.${leafKey}`,
        drafts,
      });
    }
    return;
  }
  const oldValue = stringifyAuditValue(before);
  const newValue = stringifyAuditValue(after);
  if (oldValue === newValue) return;

  let action = AuditAction.UPDATE;
  if (oldValue === null) action = AuditAction.CREATE;
  else if (newValue === null) action = AuditAction.DELETE;

  drafts.push({ action, tableName, recordId, targetName, field: fieldPath, oldValue, newValue });
}

/**
 * Diff two JSON blobs (e.g. boards.metadata) and produce one AuditChangeDraft per
 * changed top-level key, with the field name prefixed (e.g. `metadata.slaPolicyType`).
 * `formatValue` lets the caller resolve raw ids into readable names per key before
 * comparison (e.g. role ids -> role names); values it returns null for both sides
 * are skipped. Unchanged keys produce no drafts.
 *
 * `deepKeys` opts specific top-level keys into leaf-by-leaf diffing (one row per
 * inner toggle, e.g. ticketFormConfig) instead of a single formatted blob — only
 * when both sides are plain objects, so creates/deletes stay a single formatted row.
 */
export function diffJsonAuditChanges(params: {
  tableName: string;
  recordId: string;
  targetName: string;
  fieldPrefix: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  formatValue?: (key: string, value: unknown) => string | null;
  deepKeys?: string[];
}): AuditChangeDraft[] {
  const { tableName, recordId, targetName, fieldPrefix, before, after, formatValue, deepKeys } =
    params;
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const deepKeySet = deepKeys && deepKeys.length > 0 ? new Set(deepKeys) : null;
  const drafts: AuditChangeDraft[] = [];

  for (const key of keys) {
    if (after && after[key] === undefined) continue;
    const oldRaw = before ? before[key] : undefined;
    const newRaw = after ? after[key] : undefined;

    if (deepKeySet?.has(key) && isPlainObject(oldRaw) && isPlainObject(newRaw)) {
      collectDeepJsonDiff({
        tableName,
        recordId,
        targetName,
        before: oldRaw,
        after: newRaw,
        fieldPath: `${fieldPrefix}.${key}`,
        drafts,
      });
      continue;
    }

    const oldValue = formatValue
      ? formatValue(key, oldRaw)
      : stringifyAuditValue(oldRaw);
    const newValue = formatValue
      ? formatValue(key, newRaw)
      : stringifyAuditValue(newRaw);
    if (oldValue === newValue) continue;

    drafts.push({
      action: AuditAction.UPDATE,
      tableName,
      recordId,
      targetName,
      field: `${fieldPrefix}.${key}`,
      oldValue,
      newValue,
    });
  }

  return drafts;
}

/** Pick the parent audit log's rollup action from its change rows. */
export function rollupAuditAction(changes: AuditChangeDraft[]): AuditAction {
  const actions = new Set(changes.map(change => change.action));
  if (actions.size === 1) return changes[0].action;
  if (actions.size === 0) return AuditAction.UPDATE;
  return actions.has(AuditAction.DELETE)
    ? AuditAction.DELETE
    : actions.has(AuditAction.CREATE)
      ? AuditAction.CREATE
      : AuditAction.UPDATE;
}

/** Distinct record names affected by the change rows, in first-seen order. */
export function auditAffectedTargetNames(changes: AuditChangeDraft[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const change of changes) {
    if (!seen.has(change.targetName)) {
      seen.add(change.targetName);
      names.push(change.targetName);
    }
  }
  return names;
}
