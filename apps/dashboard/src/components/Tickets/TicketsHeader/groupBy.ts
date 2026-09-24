import type { HeaderGroupingOption } from './TicketsHeader.types';

type GroupByValue = HeaderGroupingOption['value'] | 'none';

interface GroupByChoice {
  key: string;
  testId: string;
  label: string;
  value: GroupByValue;
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

export const groupByChoices = (options: HeaderGroupingOption[]): GroupByChoice[] => [
  { key: 'none', testId: 'none', label: 'None', value: 'none' },
  ...options.map(option => ({
    key: optionKey(option.value),
    testId: optionTestId(option.value),
    label: stripPrefix(option.label),
    value: option.value,
  })),
];
