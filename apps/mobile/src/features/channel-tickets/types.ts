import type { TicketPriority, TicketStatusV2 } from '@xyne/shared';

/** `assignedTo` on a ticket is a bare id or a `user:` / `group:` prefixed id. */
export type ChannelTicketAssignee = { kind: 'user' | 'group'; id: string } | null;

/**
 * UI row model for the channel tickets table.
 * Zero rows map into this once (see `map-channel-ticket-row.ts`); cells never read
 * schema fields and never format at render time.
 */
export interface ChannelTicketRow {
  id: string;
  /** Human id, e.g. UPI-26222. Falls back to `id` when the row has none. */
  xyneId: string;
  title: string;
  conversationId: string;
  channelId: string;
  boardId: string;
  statusV2: TicketStatusV2 | null;
  priority: TicketPriority | null;
  stageName: string | null;
  assignee: ChannelTicketAssignee;
  eta: number | null;
  createdAt: number;
  /** "Sep 4, 2026" */
  createdAtLabel: string;
  /** "12d" */
  ageLabel: string;
  /** "Sep 4, 2026" or "—" */
  dueDateLabel: string;
  /** Overdue and not in a terminal status (dashboard `isEtaUrgent`). */
  isDueUrgent: boolean;
}

export type ChannelTicketsFilters = {
  /** Query arg: `assignedTo` OR-match. */
  assigneeIds: readonly string[];
  /** Query arg: `priority` OR-match. */
  priorities: readonly TicketPriority[];
  /** Query arg: `stageName` OR-match. */
  stageNames: readonly string[];
  /** Client-side on the loaded window; the pinned query has no board arg. */
  boardIds: readonly string[];
};

export type ChannelTicketColumnKey =
  | 'ticket'
  | 'board'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'dueDate'
  | 'stage'
  | 'createdAt'
  | 'age';

export type ChannelTicketColumnAlign = 'left' | 'center';

/** Column metadata carried on each TanStack `ColumnDef.meta`. */
export type ChannelTicketColumnMeta = {
  key: ChannelTicketColumnKey;
  align: ChannelTicketColumnAlign;
};

/**
 * Every colour the feature's views need, resolved once by
 * `useChannelTicketsPalette` and passed down as plain strings. Views never call
 * `useCSSVariable` themselves, which keeps them pure and renderable in tests
 * without a theme provider.
 */
export type ChannelTicketsPalette = {
  foreground: string;
  secondary: string;
  /** Overdue due dates. */
  urgent: string;
  /** Bubble accent: active filter indicator, drawer values, "Clear all". */
  accent: string;
  tableHeaderText: string;
  sheetHeader: string;
  sheetLabel: string;
  sheetMuted: string;
  sheetIcon: string;
  divider: string;
  /** CSS variable name → resolved colour for every status pill token. */
  byVar: ReadonlyMap<string, string>;
};

/** Id → display name maps the cells read from; resolved by `useChannelTicketsLookups`. */
export type ChannelTicketsLookups = {
  boardNameById: ReadonlyMap<string, string>;
  groupNameById: ReadonlyMap<string, string>;
  userNameById: ReadonlyMap<string, string>;
};

export type ChannelTicketsFilterKind = 'boards' | 'assignee' | 'priority' | 'stages';

export type ChannelTicketsFilterDrawerItem = {
  kind: ChannelTicketsFilterKind;
  label: string;
  /** Current selection summary, e.g. "High + 1 more". */
  value: string;
  isActive: boolean;
};
