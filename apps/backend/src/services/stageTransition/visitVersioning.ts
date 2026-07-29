import { ReenterMode } from '@prisma/client';

/**
 * Visit versioning + ETA reset/continue decision logic for NON_LINEAR stage transitions.
 *
 * Two orthogonal concerns are decided here, and they are kept DELIBERATELY INDEPENDENT:
 *
 *   1. VERSION (does a new visit version get created?)
 *      Data-driven: a new version (maxVersion + 1, new ETA row, new form values) is created
 *      ONLY when the submitted form values differ from the values stored at the current
 *      max version. If the form is unchanged the existing version is REUSED — no new row,
 *      no version bump. This is the "version + 1 only if form fields change" rule.
 *
 *   2. ETA CLOCK (does the timer restart or keep running?)
 *      Edge-config-driven via `StageTransition.onReenter ∈ { RESET, CONTINUE }`:
 *        - RESET  → rebase the clock: stageEnteredAt = now, stageEta = now + deadline.
 *        - CONTINUE → preserve the clock: leave stageEnteredAt + stageEta untouched, only
 *          clear stageLeftAt to reopen the visit.
 *      reset/continue therefore governs ONLY the timer, never the version — matching the
 *      intent that "reset and continue is for time (ETA)".
 *
 * Interaction matrix:
 *   • No prior visit (maxVersion === 0)        → version 1, NEW row, clock started fresh.
 *   • Revisit, form CHANGED                   → maxVersion + 1, NEW row, clock started
 *                                               fresh (a new visit is a new clock by
 *                                               definition; reset/continue is irrelevant).
 *   • Revisit, form UNCHANGED + RESET         → reuse maxVersion row, REBASE clock.
 *   • Revisit, form UNCHANGED + CONTINUE      → reuse maxVersion row, PRESERVE clock.
 *
 * The two paths that need it (the zql `nonLinear.transition` / approval mutator and the
 * Prisma `TicketStageTransitionService`) build the `submittedValues` / `latestValues`
 * maps from their own context and then call {@link decideVisitVersion} for the verdict.
 */

/** Normalized representation of a single field value for stable comparison. */
function canonicalizeFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    // Order-insensitive comparison for multi-value fields: sort stringified elements.
    return value
      .map(v => canonicalizeFieldValue(v))
      .sort()
      .join('');
  }
  if (typeof value === 'object') {
    // Stable JSON with sorted keys so key order never affects equality.
    return JSON.stringify(sortKeys(value as Record<string, unknown>));
  }
  // Strings: trim so incidental whitespace never triggers a spurious new version.
  return typeof value === 'string' ? value.trim() : String(value);
}

/** Recursively sort object keys so JSON serialization is order-independent. */
function sortKeys(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    const v = input[key];
    out[key] =
      v && typeof v === 'object' && !Array.isArray(v)
        ? sortKeys(v as Record<string, unknown>)
        : v;
  }
  return out;
}

/**
 * Compare two fieldName → value maps for equality using canonical normalization.
 *
 * A field absent from one side but present (and non-empty) on the other is a change.
 * A field absent from both, or empty on both, is equal. Only the SHAPE of the data
 * matters — not key order, array order, or incidental whitespace.
 */
export function formValuesEqual(
  submitted: Record<string, unknown>,
  latest: Record<string, unknown>,
): boolean {
  const allKeys = new Set([...Object.keys(submitted), ...Object.keys(latest)]);

  for (const key of allKeys) {
    if (canonicalizeFieldValue(submitted[key]) !== canonicalizeFieldValue(latest[key])) {
      return false;
    }
  }
  return true;
}

export interface VisitVersionInput {
  /** Highest existing visit version for (ticket, stage); 0 when no prior ETA exists. */
  maxVersion: number;
  /** The most recent ETA row at maxVersion (to reopen when reusing), or null. */
  existingEtaIdAtMaxVersion: string | null;
  /** This transition's submitted form values, as fieldName → value. */
  submittedValues: Record<string, unknown>;
  /** Form values stored at maxVersion (the prior visit's submission), as fieldName → value.
   *  Empty object when there is no prior visit. */
  latestValues: Record<string, unknown>;
  /** Edge-configured re-enter mode; NULL/RESET defaults to RESET. */
  reenterMode: ReenterMode | null | undefined;
}

export interface VisitVersionDecision {
  /** Authoritative visit version to stamp on the ETA row and form values. */
  newVersion: number;
  /** When reusing an existing row (form unchanged), the ETA row id to reopen; else null. */
  existingEtaId: string | null;
  /** True when a brand-new version is created (form changed, or first visit). */
  isNewVersion: boolean;
  /** True → rebase the ETA clock to now (restart timer). False → preserve the existing
   *  stageEnteredAt + stageEta on the reopened row (keep the timer running). */
  rebaseEta: boolean;
}

/**
 * Decide the visit version and ETA-clock action for a NON_LINEAR stage re/entry.
 *
 * Pure and side-effect free so it can be unit tested in isolation and shared by every
 * transition entry point (direct move, approval completion, automation/service move).
 */
export function decideVisitVersion(input: VisitVersionInput): VisitVersionDecision {
  const { maxVersion, existingEtaIdAtMaxVersion, submittedValues, latestValues, reenterMode } =
    input;

  // First visit: nothing to compare against. Always create version 1 with a fresh clock.
  if (maxVersion === 0) {
    return { newVersion: 1, existingEtaId: null, isNewVersion: true, rebaseEta: true };
  }

  // Revisit: bump the version ONLY when the submitted form actually changed vs the prior
  // visit. Identical data reuses the existing version/row — no version bloat.
  const changed = !formValuesEqual(submittedValues, latestValues);

  if (changed) {
    // A genuinely new visit: new ETA row, new version, clock starts fresh. reset/continue
    // does not apply because there is no existing clock to preserve or rebase.
    return {
      newVersion: maxVersion + 1,
      existingEtaId: null,
      isNewVersion: true,
      rebaseEta: true,
    };
  }

  // Unchanged form → reuse the existing version/row. reset/continue now controls the timer:
  //   RESET     → restart the clock on the reopened row.
  //   CONTINUE  → keep the existing clock running (only clear stageLeftAt).
  const isContinue = reenterMode === ReenterMode.CONTINUE;
  return {
    newVersion: maxVersion,
    existingEtaId: existingEtaIdAtMaxVersion,
    isNewVersion: false,
    rebaseEta: !isContinue,
  };
}

/**
 * Fold an array of stored form-value rows into a fieldName → value map for comparison.
 *
 * Callers that already hold rows keyed by fieldId pass a `fieldIdToName` map so the result
 * is keyed by fieldName (matching the shape of `submittedValues`, which the UI sends as
 * fieldName → value). Rows whose value is null/undefined are omitted — they carry no data
 * to compare and would otherwise turn "field left blank" into "field changed".
 */
export function foldFormRowsToValues(
  rows: ReadonlyArray<{
    fieldId: string;
    actualFieldValue: unknown;
  }>,
  fieldIdToName: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    if (row.actualFieldValue === null || row.actualFieldValue === undefined) continue;
    const name = fieldIdToName.get(row.fieldId);
    if (!name) continue;
    out[name] = row.actualFieldValue;
  }
  return out;
}
