import { getString, setString } from '@/src/services/localStorage';

import { feedbackStorageKey, isGuideFeedback, type GuideFeedback } from './guide-feedback-core';

/**
 * "Was this helpful?" answers, kept per device so the row remembers the answer
 * and does not nag. Nothing is uploaded; the metric is the aggregate screen
 * view, not the individual answer.
 */

export type { GuideFeedback } from './guide-feedback-core';

export function readGuideFeedback(guideId: string): GuideFeedback | null {
  const stored = getString(feedbackStorageKey(guideId));
  return isGuideFeedback(stored) ? stored : null;
}

export function writeGuideFeedback(guideId: string, feedback: GuideFeedback): void {
  setString(feedbackStorageKey(guideId), feedback);
}
