import React from 'react';
import {
  CircleDashed,
  CircleDot,
  CheckTickCircle as CircleCheck,
  ClockDefault as Clock,
  MultipleCrossCancelCircle as CircleX,
  PauseCircle as CirclePause,
  PlayCircle,
} from '@xyne/icons';

/* ── Status config ── */
interface StatusConfig {
  label: string;
  cssVar: string;
  Icon: React.FC<{ size: number }>;
}

const RUNNING: StatusConfig = {
  label: 'Running',
  cssVar: 'var(--status-pending)',
  Icon: PlayCircle,
};
const PENDING: StatusConfig = {
  label: 'Pending',
  cssVar: 'var(--status-pending)',
  Icon: CircleDot,
};
const SCHEDULED: StatusConfig = {
  label: 'Scheduled',
  cssVar: 'var(--status-scheduled)',
  Icon: Clock,
};
const SUCCESS: StatusConfig = {
  label: 'Success',
  cssVar: 'var(--status-success)',
  Icon: CircleCheck,
};
const FAILED: StatusConfig = { label: 'Failed', cssVar: 'var(--status-failure)', Icon: CircleX };
const PAUSED: StatusConfig = { label: 'Paused', cssVar: 'var(--status-paused)', Icon: CirclePause };
const NEW: StatusConfig = { label: 'New', cssVar: 'var(--status-new)', Icon: CircleDashed };
const WAITING: StatusConfig = { label: 'Waiting', cssVar: 'var(--status-scheduled)', Icon: Clock };
const COMPLETED: StatusConfig = {
  label: 'Completed',
  cssVar: 'var(--status-success)',
  Icon: CircleCheck,
};

const STATUS_CONFIG: Record<string, StatusConfig> = {
  // Uppercase (from database)
  NEW,
  PENDING,
  SCHEDULED,
  SUCCESS,
  FAILURE: FAILED,
  PAUSED,
  RUNNING,
  IN_PROGRESS: RUNNING,
  COMPLETED,
  WAITING,
  // Lowercase (workflow-level)
  new: NEW,
  running: RUNNING,
  in_progress: RUNNING,
  pending: PENDING,
  waiting: WAITING,
  completed: COMPLETED,
  success: SUCCESS,
  failed: FAILED,
  failure: FAILED,
  paused: PAUSED,
  scheduled: SCHEDULED,
  skipped: { label: 'Skipped', cssVar: 'var(--status-new)', Icon: CircleDashed },
  not_executed: { label: 'Not Executed', cssVar: 'var(--status-new)', Icon: CircleDashed },
};

const DEFAULT_STATUS: StatusConfig = {
  label: 'Unknown',
  cssVar: 'var(--status-new)',
  Icon: CircleDashed,
};

export const getStatusConfig = (status: string): StatusConfig => {
  return STATUS_CONFIG[status] ?? DEFAULT_STATUS;
};

/* ── Date formatting ── */
const ORDINAL_SPECIAL = new Set([11, 12, 13]);
const ORDINAL_MAP: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };

const SHORT_MONTHS = [
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

const getOrdinalSuffix = (day: number): string => {
  if (ORDINAL_SPECIAL.has(day)) return 'th';
  return ORDINAL_MAP[day % 10] ?? 'th';
};

const formatTime = (d: Date): string => {
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12.toString().padStart(2, '0')}:${m} ${ampm}`;
};

export const formatCreatedAt = (d: Date): string => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const time = formatTime(d);

  if (dateOnly.getTime() === today.getTime()) return `Today (${time})`;
  if (dateOnly.getTime() === yesterday.getTime()) return `Yesterday (${time})`;

  const day = d.getDate();
  const month = SHORT_MONTHS[d.getMonth()];
  const year = String(d.getFullYear()).slice(2);
  return `${day}${getOrdinalSuffix(day)} ${month}, ${year} (${time})`;
};

/* ── Shared types ── */
export interface TicketRow extends Record<string, unknown> {
  id: string;
  ticketId: string;
  ticketTitle: string;
  workflowType: string;
  status: string;
  createdBy: string;
  createdByUserId: string;
  assignedTo: string;
  assignedToUserId: string;
  createdAt: string;
  _rawTicketId: string;
}
