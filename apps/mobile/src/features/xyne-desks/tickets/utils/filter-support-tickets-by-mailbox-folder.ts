import { MailboxState } from '@xyne/shared';

import type { TicketMailboxFolder } from '../types';

export type TicketUserMailboxOverlayLike = {
  state?: string | null;
  starred?: boolean | null;
};

export type SupportTicketMailboxRowLike = {
  id: string;
  isArchived?: boolean | null;
  userMailbox?: ReadonlyArray<TicketUserMailboxOverlayLike> | null;
};

/**
 * Client-side Inbox / All Mail filter (dashboard: no-overlay defaults to Inbox).
 * Spam / Starred / Sent / Drafts are filtered server-side via mailboxFolder.
 */
export function filterSupportTicketsByMailboxFolder(
  rows: readonly SupportTicketMailboxRowLike[],
  folder: TicketMailboxFolder | undefined,
): SupportTicketMailboxRowLike[] {
  if (
    !folder ||
    folder === 'spam' ||
    folder === 'starred' ||
    folder === 'sent' ||
    folder === 'drafts'
  ) {
    return [...rows];
  }

  return rows.filter(row => {
    const overlay = row.userMailbox?.[0];
    const state = (overlay?.state as MailboxState | undefined) ?? MailboxState.INBOX;

    if (folder === 'all') {
      // Overlay-archived stays (Gmail All Mail). Ticket-level isArchived
      // never arrives from V4 (`where('isArchived', false)`) — drop it here too.
      if (row.isArchived) return false;
      return state !== MailboxState.SPAM;
    }

    // Inbox: INBOX overlay (or missing row) and not ticket-archived.
    if (state === MailboxState.SPAM || state === MailboxState.ARCHIVED) return false;
    if (row.isArchived) return false;
    return true;
  });
}
