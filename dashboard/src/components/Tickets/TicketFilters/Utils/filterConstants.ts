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

export interface QuickSelectOption {
  label: string;
  startDate: Date;
  endDate: Date;
}
