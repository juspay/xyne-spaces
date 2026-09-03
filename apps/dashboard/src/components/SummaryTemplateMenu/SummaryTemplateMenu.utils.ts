import type { SummaryTemplateOption } from './SummaryTemplateMenu.types';

/** Name of the built-in template, which has no icon of its own. */
export const DEFAULT_SUMMARY_TEMPLATE_NAME = 'Default summary';

const TEMPLATE_NAME_MAX_LENGTH = 24;

export function truncateTemplateName(name: string): string {
  return name.length > TEMPLATE_NAME_MAX_LENGTH
    ? `${name.slice(0, TEMPLATE_NAME_MAX_LENGTH - 1).trimEnd()}…`
    : name;
}

/** No template selected reads as the default, same as one named after it. */
export function isDefaultSummaryTemplate(template: SummaryTemplateOption | undefined): boolean {
  return !template || template.name === DEFAULT_SUMMARY_TEMPLATE_NAME;
}

export function getSummaryTemplateLabel(template: SummaryTemplateOption | undefined): string {
  return template?.name ?? DEFAULT_SUMMARY_TEMPLATE_NAME;
}
