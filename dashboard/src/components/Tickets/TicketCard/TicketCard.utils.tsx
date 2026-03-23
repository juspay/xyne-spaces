import React from 'react';
import { TicketPriority, TicketStatusV2, Ticket } from '@xyne/shared';

// ========================
// Status Configuration
// ========================

export interface StatusConfig {
  color: string;
  bg: string;
  icon: string;
}

/**
 * Centralized status configuration for ticket status badges
 * Used across TicketList, TicketCard, and other components
 */
export const STATUS_CONFIG: Record<TicketStatusV2, StatusConfig> = {
  [TicketStatusV2.TODO]: {
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    icon: '○',
  },
  [TicketStatusV2.STARTED]: {
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    icon: '◐',
  },
  [TicketStatusV2.PAUSED]: {
    color: 'text-yellow-600',
    bg: 'bg-yellow-50',
    icon: '⏸',
  },
  [TicketStatusV2.COMPLETED]: {
    color: 'text-green-600',
    bg: 'bg-green-50',
    icon: '✓',
  },
  [TicketStatusV2.CANCELLED]: {
    color: 'text-red-600',
    bg: 'bg-red-50',
    icon: '✕',
  },
};

// ========================
// Priority Configuration
// ========================

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  [TicketPriority.LOW]: 'Low',
  [TicketPriority.MEDIUM]: 'Medium',
  [TicketPriority.HIGH]: 'High',
  [TicketPriority.CRITICAL]: 'Critical',
};

// ========================
// Priority Icon
// ========================

export const getPriorityIcon = (priority: TicketPriority): React.ReactNode => {
  if (priority === TicketPriority.CRITICAL) {
    return (
      <svg width='15' height='14' viewBox='0 0 15 14' fill='none'>
        <path
          d='M7.5 7.41673V4.75006M7.5 9.66673V9.66748M6.57337 0.939152C7.16595 0.686949 7.83405 0.686949 8.42662 0.939152C10.1942 1.69145 14.3697 8.36453 14.2474 10.1481C14.1994 10.8472 13.8529 11.4908 13.2982 11.9114C11.823 13.0295 3.17698 13.0295 1.70185 11.9114C1.14705 11.4908 0.800603 10.8472 0.752633 10.1481C0.630263 8.36453 4.80575 1.69145 6.57337 0.939152Z'
          stroke='#E7000B'
          strokeWidth='1.5'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }

  const barHeights = [6, 10, 14];

  const priorityConfig: Record<TicketPriority, { activeBars: number; color: string }> = {
    [TicketPriority.LOW]: {
      activeBars: 1,
      color: '#10B981',
    },
    [TicketPriority.MEDIUM]: {
      activeBars: 2,
      color: '#F59E0B',
    },
    [TicketPriority.HIGH]: {
      activeBars: 3,
      color: '#F97316',
    },
    [TicketPriority.CRITICAL]: {
      activeBars: 0,
      color: '#EF4444',
    },
  };

  const { activeBars, color } = priorityConfig[priority] ?? priorityConfig[TicketPriority.LOW];

  return (
    <svg width='18' height='16' viewBox='0 0 18 16' fill='none'>
      {barHeights.map((height, index) => {
        const isActive = index < activeBars;

        return (
          <rect
            key={index}
            x={1 + index * 5}
            y={16 - height - 1}
            width='3'
            height={height}
            rx='1.5'
            fill={color}
            opacity={isActive ? 1 : 0.25}
          />
        );
      })}
    </svg>
  );
};

// ========================
// Helpers
// ========================

export const formatStatusLabel = (status: string): string => {
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, l => l.toUpperCase());
};

export const formatEta = (eta?: number | null): string => {
  if (!eta) return '';

  const date = new Date(eta);
  const day = date.getDate();

  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  return `${day} ${monthNames[date.getMonth()]}`;
};

export const isEtaUrgent = (eta?: number | null, status?: TicketStatusV2): boolean => {
  if (!eta) return false;

  const today = new Date();
  const etaDate = new Date(eta);

  today.setHours(0, 0, 0, 0);
  etaDate.setHours(0, 0, 0, 0);

  const isOverdue = etaDate.getTime() < today.getTime();
  const isTerminalState =
    status === TicketStatusV2.CANCELLED || status === TicketStatusV2.COMPLETED;

  // Only show as urgent if ETA has passed AND ticket is NOT in a terminal state
  return isOverdue && !isTerminalState;
};

export const isStageEtaOverdue = (
  ticket: Ticket & {
    stageEtaEntries?: Array<{
      stageLeftAt: number | null;
      stageEta: number | null;
    }> | null;
  },
): boolean => {
  const currentStageEntry = ticket.stageEtaEntries?.find(entry => entry.stageLeftAt === null);

  if (!currentStageEntry?.stageEta) return false;

  const now = Date.now();
  const isOverdue = now > currentStageEntry.stageEta;
  const isTerminalState =
    ticket.statusV2 === TicketStatusV2.COMPLETED || ticket.statusV2 === TicketStatusV2.CANCELLED;

  // Only show as overdue if stage ETA has passed AND ticket is NOT in a terminal state
  return isOverdue && !isTerminalState;
};
