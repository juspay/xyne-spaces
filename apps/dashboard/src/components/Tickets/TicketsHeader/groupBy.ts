import type { HeaderGroupingOption } from './TicketsHeader.types';

type GroupByValue = HeaderGroupingOption['value'] | 'none';

interface GroupByChoice {
  key: string;
  testId: string;
  label: string;
  value: GroupByValue;
  /** A board form field, kept behind the menus' "Custom fields" entry. */
  isCustomField: boolean;
}

export const optionKey = (value: GroupByValue): string =>
  typeof value === 'string' ? value : `formField-${value.fieldId}`;

const optionTestId = (value: GroupByValue): string =>
  typeof value === 'string' ? value : value.fieldId;

const stripPrefix = (label: string): string => label.replace('Group by: ', '');

export const groupByLabel = (groupBy: GroupByValue, options: HeaderGroupingOption[]): string => {
  if (groupBy === 'none') return 'None';
  if (typeof groupBy === 'object') return groupBy.fieldName;
  return stripPrefix(options.find(option => option.value === groupBy)?.label ?? 'None');
};

const groupByChoices = (options: HeaderGroupingOption[]): GroupByChoice[] => [
  { key: 'none', testId: 'none', label: 'None', value: 'none', isCustomField: false },
  ...options.map(option => ({
    key: optionKey(option.value),
    testId: optionTestId(option.value),
    label: stripPrefix(option.label),
    value: option.value,
    isCustomField: typeof option.value === 'object',
  })),
];

/**
 * The group-by menu in two parts: built-in criteria, and the board's custom form fields —
 * which sit behind one "Custom fields" entry rather than padding the flat list.
 * `activeCustom` lets that entry name the field currently grouped by, so an active grouping
 * is never hidden behind a collapsed row.
 */
export const splitGroupByChoices = (
  options: HeaderGroupingOption[],
  activeGroupKey: string,
): {
  standard: GroupByChoice[];
  customFields: GroupByChoice[];
  activeCustom: GroupByChoice | undefined;
} => {
  const choices = groupByChoices(options);
  const standard = choices.filter(choice => !choice.isCustomField);
  const customFields = choices.filter(choice => choice.isCustomField);
  return {
    standard,
    customFields,
    activeCustom: customFields.find(choice => choice.key === activeGroupKey),
  };
};
