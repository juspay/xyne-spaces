import type { ReactElement } from 'react';
import { COEStatus, SEVERITY, LookupType } from '@xyne/shared';
import type { PhaseConfig, COEStatusOption, ReadOnlyFieldProps } from './RCAScreen.types';

export const coeStatusOptions: COEStatusOption[] = [
  { label: 'Open', value: COEStatus.OPEN },
  { label: 'In Progress', value: COEStatus.IN_PROGRESS },
  { label: 'Completed', value: COEStatus.COMPLETED },
];

export const severityOptions = [
  { label: 'SEV 1', value: SEVERITY.SEV_1 },
  { label: 'SEV 2', value: SEVERITY.SEV_2 },
  { label: 'SEV 3', value: SEVERITY.SEV_3 },
];

export const phases: PhaseConfig[] = [
  { id: 'release', label: 'Attribution', description: '' },
  { id: 'rca', label: 'RCA', description: '' },
  { id: 'impact', label: 'Impact', description: '' },
  { id: 'coe', label: 'COE', description: '' },
];

export const bugCategoryValueMap: Record<string, string[]> = {
  Reliability: ['Change', 'Capacity', 'Fault'],
  Performance: ['N', 'C', 'P/U'],
  'UI/UX': ['UI/UX'],
};

export const issueCategoryLookupTypeByCategoryValue: Record<string, LookupType> = {
  Capacity: LookupType.BUG_ISSUE_CATEGORY_CAPACITY,
  Change: LookupType.BUG_ISSUE_CATEGORY_CHANGE,
  Fault: LookupType.BUG_ISSUE_CATEGORY_FAULT,
};

export const issueResolutionLookupTypeByCategoryValue: Record<string, LookupType> = {
  Capacity: LookupType.BUG_RESOLUTION_CAPACITY,
  Change: LookupType.BUG_RESOLUTION_CHANGE,
  Fault: LookupType.BUG_RESOLUTION_FAULT,
};

/** Format enum-like values into readable labels. */
export const formatEnumLabel = (value: string): string =>
  value
    .toLowerCase()
    .split('_')
    .map(part => (part ? part[0]?.toUpperCase() + part.slice(1) : part))
    .join(' ');

/** Format ISO-like date strings into a readable date. */
export const formatDate = (value?: string | number | null): string => {
  if (!value) return '-';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString();
};

/** Render a field-level error message. Only shows error if field has been touched. */
export const renderFieldError = (
  error?: string | null,
  isTouched?: boolean,
): ReactElement | null =>
  error && isTouched ? <p className='text-sm text-red-600 mt-1'>{error}</p> : null;

/** Read-only field display for locked phases. */
export const ReadOnlyField = ({ label, value }: ReadOnlyFieldProps): ReactElement => (
  <div className='space-y-1.5'>
    <p className='text-sm font-medium text-foreground'>{label}</p>
    <div className='px-3 py-2 text-sm bg-muted border border-border rounded-lg'>{value}</div>
  </div>
);
