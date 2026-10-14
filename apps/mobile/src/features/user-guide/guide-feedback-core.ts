/**
 * Pure half of the "Was this helpful?" store: key naming and value parsing.
 * Split from `guide-feedback.ts` so node tests can cover it without loading
 * the MMKV-backed storage module, which needs the native runtime.
 */

export type GuideFeedback = 'yes' | 'no';

const FEEDBACK_KEY_PREFIX = 'lotus.user-guide.feedback.';

export function feedbackStorageKey(guideId: string): string {
  return `${FEEDBACK_KEY_PREFIX}${guideId}`;
}

export function isGuideFeedback(value: string | null): value is GuideFeedback {
  return value === 'yes' || value === 'no';
}
