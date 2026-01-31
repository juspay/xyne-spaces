import { TicketPriority } from '@xyne/shared';

export const PRIORITY_CONFIG = {
  [TicketPriority.LOW]: { label: 'Low', color: 'bg-gray-100 text-gray-700 border-gray-200' },
  [TicketPriority.MEDIUM]: { label: 'Medium', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  [TicketPriority.HIGH]: {
    label: 'High',
    color: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  },
  [TicketPriority.CRITICAL]: { label: 'Critical', color: 'bg-red-100 text-red-700 border-red-200' },
};

export const DATE_FILTER_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'lastWeek', label: 'Last 7 Days' },
  { value: 'lastMonth', label: 'Last 30 Days' },
  { value: 'custom', label: 'Custom Range' },
] as const;

export interface QuickSelectOption {
  label: string;
  startDate: Date;
  endDate: Date;
}

export const QUICK_SELECT_OPTIONS: QuickSelectOption[] = [
  {
    label: 'Today',
    startDate: new Date(new Date().setHours(0, 0, 0, 0)),
    endDate: new Date(new Date().setHours(23, 59, 59, 999)),
  },
  {
    label: 'Yesterday',
    startDate: new Date(new Date().setDate(new Date().getDate() - 1)),
    endDate: new Date(new Date().setDate(new Date().getDate() - 1)),
  },
  {
    label: 'Last 7 Days',
    startDate: new Date(new Date().setDate(new Date().getDate() - 7)),
    endDate: new Date(),
  },
];
