import { CircleDashed, CircleDot, Signature, CircleX, CircleCheck } from 'lucide-react';
import { TicketStatusV2, type User } from '@xyne/shared';

/**
 * Types for Board Stage Configuration Screen
 */

export interface StageCondition {
  id: string;
  name: string;
  whenField: string;
  whenCondition: string;
  whenValue: string;
  thenField: string;
  thenCondition: string;
  thenValue: string;
  approverIds?: string[];
}

export interface StageNode {
  id?: string;
  tempId: number;
  name: string;
  eta: number;
  sequenceNumber: number;
  defaultTicketStatusV2: TicketStatusV2;
  prStatuses: string[];
  approverIds: string[];
  selectedApprovers: User[];
  formId?: string;
  conditions: StageCondition[];
  // Visual properties
  position: { x: number; y: number };
}

// Re-export from shared for convenience
export type { User };

// Constants
// Status options for the status indicator (used in stage config)
export const STATUS_OPTIONS = [
  {
    status: TicketStatusV2.TODO,
    label: 'To Do',
    icon: <CircleDashed strokeWidth={2.5} className='w-3.5 h-3.5 text-orange-500' />,
  },
  {
    status: TicketStatusV2.STARTED,
    label: 'Started',
    icon: <CircleDot strokeWidth={2.5} className='w-3.5 h-3.5 text-blue-500' />,
  },
  {
    status: TicketStatusV2.PAUSED,
    label: 'Paused',
    icon: <Signature strokeWidth={2.5} className='w-3.5 h-3.5 text-teal-500' />,
  },
  {
    status: TicketStatusV2.COMPLETED,
    label: 'Completed',
    icon: <CircleCheck strokeWidth={2.5} className='w-3.5 h-3.5 text-green-500' />,
  },
  {
    status: TicketStatusV2.CANCELLED,
    label: 'Cancelled',
    icon: <CircleX strokeWidth={2.5} className='w-3.5 h-3.5 text-red-500' />,
  },
];

export const getStatusOption = (
  status: TicketStatusV2,
): { status: TicketStatusV2; label: string; icon: React.ReactElement } => {
  return STATUS_OPTIONS.find(opt => opt.status === status) ?? STATUS_OPTIONS[0]!;
};
