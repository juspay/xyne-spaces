import type { AuditChangeDraft, AuditEntityType } from '@xyne/shared';
import type { AuditResolution } from './resolution';

export type AuditOperation = 'insert' | 'update' | 'upsert' | 'delete';

/** A mutated row in camelCase shape — identical for Zero rows and Prisma rows. */
export type AuditRow = Record<string, unknown>;

export interface AuditScope {
  entityType: AuditEntityType;
  entityId: string;
}

export interface AuditStageRow {
  id: string;
  name: string;
  boardId: string;
}

export interface AuditTransitionRow {
  id: string;
  boardId: string;
  fromStageId: string | null;
  toStageId: string;
}

/**
 * Bulk lookups implemented once per store (Zero tx / Prisma client) and shared by
 * the table config's resolvers and formatters.
 */
export interface AuditLookup {
  stagesByIds(ids: string[]): Promise<AuditStageRow[]>;
  transitionsByIds(ids: string[]): Promise<AuditTransitionRow[]>;
  boardsByIds(ids: string[]): Promise<{ id: string; name: string }[]>;
  usersByIds(ids: string[]): Promise<{ id: string; displayName?: string | null; name?: string | null }[]>;
  rolesByIds(ids: string[]): Promise<{ id: string; name: string }[]>;
  formsByIds(ids: string[]): Promise<{ id: string; formName: string }[]>;
  globalFieldsByIds(ids: string[]): Promise<{ id: string; fieldName: string }[]>;
  userGroupsByIds(ids: string[]): Promise<{ id: string; name: string }[]>;
  /** board ids a form is bound to, resolved through forms_context_mapping (BOARD + STAGE contexts). */
  boardIdsForFormIds(formIds: string[]): Promise<{ formId: string; boardIds: string[] }[]>;
  /** Assignment-state rows of a user group's current members (state rows outlive membership). */
  memberAssignmentStates(userGroupId: string): Promise<AuditRow[]>;
}

/**
 * Set-level totals (e.g. on-call members of a group) recorded as extra change rows
 * whenever a save moves them. The set is snapshotted before the save's first write
 * to it; each written row then moves the totals by its own before/after.
 */
export interface AuditCounters {
  /** Column whose value identifies the counted set, e.g. userGroupId. */
  groupBy: string;
  /** Change-group label for the totals rows. */
  targetName: string;
  /** Counter field -> whether a row counts towards it. */
  fields: Record<string, (row: AuditRow) => boolean>;
  /** The set's rows as they currently stand. */
  loadRows(key: string, lookup: AuditLookup): Promise<AuditRow[]>;
}

/** How far one written row moved a counted set. */
export interface AuditCounterDelta {
  table: string;
  key: string;
  delta: Record<string, number>;
}

export interface AuditJob {
  scope: AuditScope;
  drafts: AuditChangeDraft[];
  counterDelta?: AuditCounterDelta;
}

export interface AuditDeleteSummary {
  /** Field name recorded on the DELETE change row. */
  field: string;
  /** Value recorded as oldValue; defaults to the (formatted) field value. */
  value?: (row: AuditRow, res: AuditResolution) => string | null;
}

export interface AuditTableConfig {
  /** Primary-key column when it isn't `id` (e.g. email_channel_preferences.channelId). */
  primaryKey?: string;
  /** Resolve the audit scope(s) for a mutated row; null/[] = not auditable. */
  resolveScope(row: AuditRow, res: AuditResolution): Promise<AuditScope | AuditScope[] | null>;
  /** Human label of the changed row (audit targetName). */
  resolveTargetName(row: AuditRow, res: AuditResolution): Promise<string>;
  /** Bulk-resolve names needed by the field/json formatters before diffing. */
  prewarm?(beforeRow: AuditRow | null, afterRow: AuditRow | null, res: AuditResolution): Promise<void>;
  /** Per-field value formatters (e.g. userId -> display name), sync after prewarm. */
  fieldFormatters?: Record<string, (value: unknown, res: AuditResolution) => string | null>;
  /** JSON columns diffed per sub-key: column -> (sub-key, value) formatter, sync after prewarm. */
  jsonFields?: Record<string, (key: string, value: unknown, res: AuditResolution) => string | null>;
  /**
   * Top-level keys of a JSON column diffed leaf-by-leaf instead of formatted into
   * one value — for nested blobs whose inner toggles matter individually, e.g.
   * `{ metadata: ['ticketFormConfig'] }` emits `metadata.ticketFormConfig.todo.enabled`.
   */
  deepJsonFields?: Record<string, string[]>;
  /** Fields never audited for this table (on top of the global ignores). */
  ignoreFields?: string[];
  /** INSERT baselines: fields equal to these defaults produce no CREATE drafts (first-save noise control). */
  createDefaults?: Record<string, unknown>;
  /** Single summary draft recorded for DELETE rows. */
  deleteSummary?: AuditDeleteSummary;
  /**
   * Natural-key fingerprint for tables whose mutators replace rows
   * (delete + reinsert with a NEW id) instead of updating them — the flush
   * pairs DELETE/CREATE drafts sharing a fingerprint and merges them.
   */
  reconcileKey?: (row: AuditRow) => string;
  /** Set-level totals recorded alongside this table's row changes. */
  counters?: AuditCounters;
}

/**
 * Per-save accumulator: every audited mutation of one mutator execution pushes its
 * drafts here; the flush groups them into one parent audit log row per scope.
 */
export interface AuditJobsAccumulator {
  jobs: AuditJob[];
  resolution: AuditResolution;
}
