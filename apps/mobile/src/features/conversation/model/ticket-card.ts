import type { TicketPreview } from '@/src/features/chat/v2/paint/chatPaint.types';

import {
  MESSAGE_CARD_FRAME_PADDING,
  TICKET_META_LINE_HEIGHT,
  TICKET_NUMBER_ROW_HEIGHT,
  TICKET_STUB_GAP,
  TICKET_STUB_PADDING_X,
  TICKET_STUB_PADDING_Y,
  TICKET_TITLE_LINE_HEIGHT,
  TICKET_TITLE_MAX_LINES,
} from '../constants';
import { dayMonthOf } from './message-time';

/** Figma "Ticket / Status": Todo dashed, In progress half full, Done full, Blocked red ring. */
export type TicketStatusGlyph = 'todo' | 'inProgress' | 'done' | 'blocked';

/** Figma "Ticket / Priority": three rising bars, `lit` of them dark; urgent lights all three red. */
export type TicketPriorityMark = { label: string; lit: 1 | 2 | 3; isUrgent: boolean };

type TicketCardModel = {
  number: string;
  title: string;
  status: { label: string; glyph: TicketStatusGlyph };
  priority: TicketPriorityMark | null;
  /** The ticket's ETA as "15 Oct"; null when it has none. */
  dueLabel: string | null;
};

/** What the ticket's own record adds to the paint row's preview. */
type TicketRecordFacts = {
  statusV2?: string | null | undefined;
  eta?: number | null | undefined;
};

const STATUS_GLYPH: Readonly<Record<string, TicketStatusGlyph>> = {
  TODO: 'todo',
  STARTED: 'inProgress',
  COMPLETED: 'done',
  PAUSED: 'blocked',
  CANCELLED: 'blocked',
};

const PRIORITY_MARK: Readonly<Record<string, TicketPriorityMark>> = {
  LOW: { label: 'Low', lit: 1, isUrgent: false },
  MEDIUM: { label: 'Medium', lit: 2, isUrgent: false },
  HIGH: { label: 'High', lit: 3, isUrgent: false },
  CRITICAL: { label: 'Urgent', lit: 3, isUrgent: true },
};

/** Timestamps below this are seconds, not milliseconds (it is 2001 in ms, 33658 in s). */
const SECONDS_CUTOFF = 1e12;

/** "15 Oct", in the device's zone; empty for a missing or non-positive time. */
export function dayMonthLabel(timestamp: number | null | undefined): string {
  if (!timestamp || !Number.isFinite(timestamp) || timestamp <= 0) return '';
  const date = new Date(timestamp < SECONDS_CUTOFF ? timestamp * 1000 : timestamp);
  return dayMonthOf(date);
}

/**
 * The card's words and marks from the paint row's ticket preview and, when
 * the conversation carries it, the ticket record (status stage and ETA). An
 * unknown status reads as to-do; an unknown priority is left off.
 */
export function ticketCardModel(
  preview: TicketPreview,
  record: TicketRecordFacts | null,
): TicketCardModel {
  const dueLabel = dayMonthLabel(record?.eta);
  return {
    number: preview.ticketId,
    title: preview.title,
    status: {
      label: preview.statusLabel,
      glyph: STATUS_GLYPH[record?.statusV2 ?? ''] ?? 'todo',
    },
    priority: PRIORITY_MARK[preview.priority ?? ''] ?? null,
    dueLabel: dueLabel || null,
  };
}

/** How much narrower than the body the ticket's title is: the frame and the stub's padding. */
export const TICKET_TITLE_INSET = (MESSAGE_CARD_FRAME_PADDING + TICKET_STUB_PADDING_X) * 2;

/** The card's height with a title of `titleLines` lines (one or two; Figma's two variants). */
export function ticketCardHeight(titleLines: number): number {
  const lines = Math.min(TICKET_TITLE_MAX_LINES, Math.max(1, titleLines));
  return (
    (MESSAGE_CARD_FRAME_PADDING + TICKET_STUB_PADDING_Y) * 2 +
    TICKET_NUMBER_ROW_HEIGHT +
    lines * TICKET_TITLE_LINE_HEIGHT +
    TICKET_META_LINE_HEIGHT +
    TICKET_STUB_GAP * 2
  );
}
