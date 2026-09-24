import { AuditAction } from './types';

/**
 * Generic audit-trail helpers.
 *
 * The audit trail is generalized: any write path can record its changes by
 * diffing the before/after state of each mutated row. `diffAuditChanges`
 * produces the field-level change rows; the caller inserts them (plus one
 * parent audit log row) in the same transaction as the mutation itself.
 */

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

/**
 * Diff two JSON blobs (e.g. boards.metadata) and produce one AuditChangeDraft per
 * changed top-level key, with the field name prefixed (e.g. `metadata.slaPolicyType`).
 * `formatValue` lets the caller resolve raw ids into readable names per key before
 * comparison (e.g. role ids -> role names); values it returns null for both sides
 * are skipped. Unchanged keys produce no drafts.
 */
export function diffJsonAuditChanges(params: {
  tableName: string;
  recordId: string;
  targetName: string;
  fieldPrefix: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  formatValue?: (key: string, value: unknown) => string | null;
}): AuditChangeDraft[] {
  const { tableName, recordId, targetName, fieldPrefix, before, after, formatValue } = params;
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const drafts: AuditChangeDraft[] = [];

  for (const key of keys) {
    if (after && after[key] === undefined) continue;
    const oldRaw = before ? before[key] : undefined;
    const newRaw = after ? after[key] : undefined;
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
