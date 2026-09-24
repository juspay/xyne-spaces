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

/** Transcript characters the template-selection prompt keeps; anything beyond is dropped. */
export const SUMMARY_TEMPLATE_SELECTION_MAX_TRANSCRIPT_CHARS = 60_000;

/** Characters of any single summary input (transcript, notes, prompts) the summary prompt keeps. */
export const SUMMARY_MAX_INPUT_CHARS = 100_000;
