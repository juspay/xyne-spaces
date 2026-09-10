/**
 * Reserved ids of the Decisions / Action Items sections that the summary template
 * editor always includes. Shared so the dashboard payload and the backend's
 * permission checks can never drift apart.
 */
export const MANDATORY_SUMMARY_SECTION_IDS = {
  decisions: 'mandatory-decisions',
  actionItems: 'mandatory-action-items',
} as const;

export type MandatorySummarySectionId =
  (typeof MANDATORY_SUMMARY_SECTION_IDS)[keyof typeof MANDATORY_SUMMARY_SECTION_IDS];
