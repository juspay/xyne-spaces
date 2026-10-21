import { MANDATORY_SUMMARY_SECTION_IDS } from '@xyne/shared';
import type { SummaryTemplateSection } from '../../../services/Recording/recordingService';

export const MANDATORY_SECTIONS = [
  {
    id: MANDATORY_SUMMARY_SECTION_IDS.decisions,
    key: 'decisions',
    title: '✅ Decisions',
    displayTitle: 'Decisions',
    description:
      'Every meeting decision, who made it, and why. High-confidence decisions are pinned to the timeline, uncertain ones appear as “Suggested” for verification.',
    legacyDescriptions: ['- [Decision] — Owner: [Person] ([why / context])'],
    dotClassName: 'bg-primary',
  },
  {
    id: MANDATORY_SUMMARY_SECTION_IDS.actionItems,
    key: 'action items',
    title: '📋 Action Items',
    displayTitle: 'Action items',
    description:
      'Who does what by when — one line per task, owner attributed from the speaker. Each item links back to the moment it was said.',
    legacyDescriptions: ['- [Task] — @[Assignee] · Due: [Date] · Priority: [H/M/L]'],
    dotClassName: 'bg-action-primary',
  },
] as const;
export const MAX_TEMPLATE_TITLE_LENGTH = 120;
export const MAX_MEETING_CONTEXT_LENGTH = 500;
export const MAX_SECTION_TITLE_LENGTH = 100;
export const MAX_SECTION_DESCRIPTION_LENGTH = 500;
export const MAX_SYSTEM_PROMPT_LENGTH = 12_000;

export const MAX_TEMPLATE_SECTIONS = 20;
export const MAX_EDITABLE_SECTIONS = MAX_TEMPLATE_SECTIONS - MANDATORY_SECTIONS.length;

export const normalizedSectionTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const findMandatorySection = (
  title: string,
): (typeof MANDATORY_SECTIONS)[number] | undefined =>
  MANDATORY_SECTIONS.find(({ key }) => normalizedSectionTitle(title) === key);

export const isReservedSectionTitle = (title: string): boolean =>
  findMandatorySection(title) !== undefined;

export const isMandatorySection = (section: Pick<SummaryTemplateSection, 'id'>): boolean =>
  MANDATORY_SECTIONS.some(({ id }) => section.id === id);

/**
 * Mandatory sections are stored in the regular sections payload so summary generation keeps
 * using the existing API contract. Runtime checks use reserved IDs rather than editable titles,
 * so a custom section named "Decisions" remains a normal editable section.
 *
 * A Scribe admin can switch a mandatory section off; the `disabled` flag is the only part of
 * these sections that persists from the incoming payload, so title/description stay canonical.
 */
export const withMandatorySections = (
  sections: SummaryTemplateSection[],
): SummaryTemplateSection[] => {
  const editableSections = sections.filter(section => !isMandatorySection(section));
  const mandatorySections = MANDATORY_SECTIONS.map(definition => ({
    id: definition.id,
    title: definition.title,
    description: definition.description,
    ...(sections.find(section => section.id === definition.id)?.disabled === true
      ? { disabled: true }
      : {}),
  }));

  return [...editableSections, ...mandatorySections];
};
