import React from 'react';
import { TicketPriority, TicketStatusV2, Ticket } from '@xyne/shared';

export const getPriorityIcon = (priority: TicketPriority): React.ReactNode => {
  if (priority === TicketPriority.CRITICAL) {
    return (
      <svg width='15' height='14' viewBox='0 0 15 14' fill='none' className='stroke-xyne-red-500'>
        <path
          d='M7.5 7.41673V4.75006M7.5 9.66673V9.66748M6.57337 0.939152C7.16595 0.686949 7.83405 0.686949 8.42662 0.939152C10.1942 1.69145 14.3697 8.36453 14.2474 10.1481C14.1994 10.8472 13.8529 11.4908 13.2982 11.9114C11.823 13.0295 3.17698 13.0295 1.70185 11.9114C1.14705 11.4908 0.800603 10.8472 0.752633 10.1481C0.630263 8.36453 4.80575 1.69145 6.57337 0.939152Z'
          stroke='currentColor'
          strokeWidth='1.5'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }

  const barHeights = [6, 10, 14];

  const priorityConfig: Record<TicketPriority, { activeBars: number; colorClass: string }> = {
    [TicketPriority.LOW]: {
      activeBars: 1,
      colorClass: 'fill-xyne-green-400',
    },
    [TicketPriority.MEDIUM]: {
      activeBars: 2,
      colorClass: 'fill-xyne-yellow-400',
    },
    [TicketPriority.HIGH]: {
      activeBars: 3,
      colorClass: 'fill-xyne-orange-400',
    },
    [TicketPriority.CRITICAL]: {
      activeBars: 0,
      colorClass: 'fill-xyne-red-400',
    },
  };

  const { activeBars, colorClass } = priorityConfig[priority] ?? priorityConfig[TicketPriority.LOW];

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
            className={colorClass}
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

export const isStageOverdue = (ticket: Ticket & { isStageOverdue?: boolean | null }): boolean => {
  const isTerminalState =
    ticket.statusV2 === TicketStatusV2.CANCELLED || ticket.statusV2 === TicketStatusV2.COMPLETED;
  return Boolean(ticket.isStageOverdue) && !isTerminalState;
};
