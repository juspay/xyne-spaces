/** Search params of the link a summary-template share notification points at. */
export const SUMMARY_TEMPLATES_PARAM = 'templates';
export const SUMMARY_TEMPLATE_ID_PARAM = 'summaryTemplateId';

/** Must match the `actionUrl` the backend puts on the share notification. */
export const buildSummaryTemplateLink = (templateId: string): string =>
  `/recordings?${SUMMARY_TEMPLATES_PARAM}=1&${SUMMARY_TEMPLATE_ID_PARAM}=${encodeURIComponent(templateId)}`;

/** `unavailable`: the complete list does not have the linked template. */
export type SummaryTemplateLinkState = 'none' | 'resolving' | 'found' | 'unavailable';

export interface ResolveSummaryTemplateLinkParams {
  linkedTemplateId: string | null;
  /** Ids of the templates the viewer can see so far. */
  templateIds: readonly string[];
  /** Whether the server has confirmed the whole list. */
  isComplete: boolean;
}

/** A missing id only means unavailable once the list is complete. */
export const resolveSummaryTemplateLink = ({
  linkedTemplateId,
  templateIds,
  isComplete,
}: ResolveSummaryTemplateLinkParams): SummaryTemplateLinkState => {
  if (!linkedTemplateId) return 'none';
  if (templateIds.includes(linkedTemplateId)) return 'found';
  return isComplete ? 'unavailable' : 'resolving';
};
