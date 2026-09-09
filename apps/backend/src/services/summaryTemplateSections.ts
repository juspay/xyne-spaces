import type { Prisma } from '@prisma/client';

/**
 * Reserved ids for the two sections the template editor always includes. They are
 * stored in the regular `sections` payload; a Scribe admin can flag one as
 * `disabled` so it is dropped from generation without being removed from the
 * template, letting it be switched back on later.
 */
export const MANDATORY_SUMMARY_SECTION_IDS = {
  decisions: 'mandatory-decisions',
  actionItems: 'mandatory-action-items',
} as const;

export interface MandatorySummarySectionState {
  decisions: boolean;
  actionItems: boolean;
}

export type SummaryTemplateSectionRecord = Prisma.JsonObject & {
  id?: string;
  title?: string;
  description?: string;
  disabled?: boolean;
};

export function isSummaryTemplateSectionRecord(
  section: Prisma.JsonValue
): section is SummaryTemplateSectionRecord {
  return typeof section === 'object' && section !== null && !Array.isArray(section);
}

export function isMandatorySummarySectionId(id: unknown): boolean {
  return (
    id === MANDATORY_SUMMARY_SECTION_IDS.decisions || id === MANDATORY_SUMMARY_SECTION_IDS.actionItems
  );
}

export function isSummaryTemplateSectionDisabled(section: Prisma.JsonValue): boolean {
  return isSummaryTemplateSectionRecord(section) && section.disabled === true;
}

/** Sections that should reach the prompt: everything not explicitly disabled. */
export function getEnabledSummaryTemplateSections(sections: Prisma.JsonValue): Prisma.JsonValue {
  if (!Array.isArray(sections)) return sections;
  return sections.filter((section) => !isSummaryTemplateSectionDisabled(section));
}

/** Which of the mandatory sections are still enabled for a template. */
export function getMandatorySummarySectionState(
  sections: Prisma.JsonValue
): MandatorySummarySectionState {
  const state: MandatorySummarySectionState = { decisions: true, actionItems: true };
  if (!Array.isArray(sections)) return state;
  for (const section of sections) {
    if (!isSummaryTemplateSectionRecord(section) || section.disabled !== true) continue;
    if (section.id === MANDATORY_SUMMARY_SECTION_IDS.decisions) state.decisions = false;
    if (section.id === MANDATORY_SUMMARY_SECTION_IDS.actionItems) state.actionItems = false;
  }
  return state;
}

/** Ids of the mandatory sections flagged as disabled, for change detection. */
export function getDisabledMandatorySummarySectionIds(sections: Prisma.JsonValue): Set<string> {
  const state = getMandatorySummarySectionState(sections);
  const ids = new Set<string>();
  if (!state.decisions) ids.add(MANDATORY_SUMMARY_SECTION_IDS.decisions);
  if (!state.actionItems) ids.add(MANDATORY_SUMMARY_SECTION_IDS.actionItems);
  return ids;
}

/** True when a non-mandatory section carries the `disabled` flag, which is never allowed. */
export function hasDisabledNonMandatorySummarySection(sections: Prisma.JsonValue): boolean {
  if (!Array.isArray(sections)) return false;
  return sections.some(
    (section) =>
      isSummaryTemplateSectionRecord(section) &&
      section.disabled === true &&
      !isMandatorySummarySectionId(section.id)
  );
}
