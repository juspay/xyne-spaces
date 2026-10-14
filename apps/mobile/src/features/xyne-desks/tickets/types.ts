/**
 * UI model for desk ticket rows.
 * Zero ticket rows map into this — list components never speak schema.
 */
export interface TicketListItemData {
  id: string;
  /** Human id e.g. UPI-26222 */
  xyneId: string;
  title: string;
  stageName: string | null;
  emailCount: number;
  lastEmailAt: number;
  isUnread: boolean;
  /** EMAIL mailbox overlay — star icon in list (hidden on APP/SLACK). */
  isStarred: boolean;
  /** Gmail-style primary line (from metadata or fallback) */
  senderName: string;
  /** Tertiary preview line */
  snippet: string;
}

export type TicketMailboxFolder = 'inbox' | 'all' | 'starred' | 'spam' | 'drafts' | 'sent';

export type TicketMailboxFolderItem = {
  id: TicketMailboxFolder;
  label: string;
  /** Optional count badge */
  count?: number;
};

/** Row position inside the inbox group — drives Gmail-style corner radii. */
export type TicketListItemPosition = 'single' | 'first' | 'middle' | 'last';

/** Filter kinds listed in the desk Tickets "Filters" drawer. */
export type TicketsFilterKind =
  | 'myTickets'
  | 'assignee'
  | 'priority'
  | 'stages'
  | 'hasAiDraft'
  | 'hasSubTickets'
  | 'aiCategory'
  | 'aiTags'
  | 'userGroups'
  | 'createdBy'
  | 'label'
  | 'dynamicField'
  | 'lastUpdated'
  | 'date';

export type TicketsFilterDrawerItem = {
  kind: TicketsFilterKind;
  label: string;
  /** Active summary shown under the label; "Any" / "Off" when inactive. */
  value: string;
  isActive: boolean;
  /** Toggle rows flip in-place; nav rows open a picker after the drawer closes. */
  variant?: 'nav' | 'toggle';
  /** Set when kind === 'dynamicField'. */
  fieldId?: string;
};
