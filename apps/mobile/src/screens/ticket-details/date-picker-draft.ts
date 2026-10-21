/**
 * Pure helpers for ticket Due Date / Status Deadline picking.
 * Kept free of React Native so node:test coverage can import them.
 */

/** Minute bucket used by ticket Due Date / Status Deadline equality checks. */
export function toMinutePrecision(ms: number): number {
  return Math.floor(ms / 60_000);
}

export function isSameMinute(aMs: number, bMs: number): boolean {
  return toMinutePrecision(aMs) === toMinutePrecision(bMs);
}

/**
 * Seed the editable draft.
 * Existing values are preserved even when overdue (past `minimumDate`) so opening
 * + Save without edits is a no-op. `minimumDate` only seeds empty / invalid values.
 */
export function startOfDraft(valueMs: number | null, minimumDate?: Date): Date {
  if (valueMs !== null && Number.isFinite(valueMs)) {
    return new Date(valueMs);
  }
  if (minimumDate) return new Date(minimumDate);
  return new Date();
}

/**
 * Apply `minimumDate` to spinner changes, except while editing an already-overdue
 * value — past drafts must stay so same-minute Save can no-op.
 */
export function clampPickerSelection(
  next: Date,
  args: { value: number | null; minimumDate?: Date },
): Date {
  const { value, minimumDate } = args;
  if (!minimumDate || next.getTime() >= minimumDate.getTime()) {
    return next;
  }
  const openedOverdue = value !== null && Number.isFinite(value) && value < minimumDate.getTime();
  if (openedOverdue) {
    return next;
  }
  return new Date(minimumDate);
}
