import { useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { LinkChainSlant, TicketToken } from '@xyne/icons';
import { EntitySelector } from '../../../components/ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../../components/ui/EntitySelector/EntitySelector.types';
import { Tooltip } from '../../../components/ui/Tooltip';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { queries } from '../../../zero/queries';

export interface RecordingTicketLinkProps {
  /** The single ticket this recording points at; null/undefined when unlinked. */
  linkedTicketId: string | null | undefined;
  /** Owner or editor: may link and unlink. Viewers see it read-only. */
  canEdit: boolean;
  /** Prevent duplicate link/unlink mutations while the current one is pending. */
  isUpdating?: boolean;
  /** `null` unlinks. */
  onChange: (ticketId: string | null, ticket?: RecordingTicketTarget) => void;
}

export interface RecordingTicketTarget {
  id: string;
  label: string;
}

/** Rows per search page. The list is a picker, not a browser — it stays scannable. */
const TICKET_SEARCH_LIMIT = 20;

/** Matches the header's other pills (date, labels, share). */
const CHIP_CLASS_NAME =
  'inline-flex h-6 items-center gap-1.5 rounded-lg border border-border bg-background px-2 text-xs font-normal text-foreground shadow-xs';

/**
 * Links a recording to exactly one ticket. `EntitySelector`'s `selectedValue` is a
 * single id, so "only one" is a contract rather than a convention.
 *
 * Candidates come from `ticketsSearch`, not Vespa: it is live, matches xyneId and
 * title, and is already scoped by `TicketsACL`, so the picker cannot surface a
 * ticket the viewer has no access to.
 */
export function RecordingTicketLink({
  linkedTicketId,
  canEdit,
  isUpdating = false,
  onChange,
}: RecordingTicketLinkProps): ReactElement | null {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);

  // Only while the picker is open — an unopened dropdown shouldn't hold a live
  // query over the workspace's tickets.
  const [searchResults] = useCachedQuery(
    queries.ticketsSearch({
      search: debouncedSearch.trim() || undefined,
      limit: TICKET_SEARCH_LIMIT,
    }),
    { enabled: canEdit && isOpen },
  );

  const [linkedRows, linkedRowsDetails] = useCachedQuery(
    queries.ticketsByIds({ ticketIds: linkedTicketId ? [linkedTicketId] : [] }),
    { enabled: !!linkedTicketId },
  );
  const linkedTicket = linkedRows?.[0] ?? null;
  // TicketsACL returns no rows for a ticket the viewer cannot see, which looks
  // just like "not fetched yet" — only a settled empty result means denied.
  const isTicketDenied = !linkedTicket && linkedRowsDetails.type === 'complete';

  const options = useMemo<SelectorOption[]>(
    () =>
      (searchResults ?? []).map(ticket => ({
        value: ticket.id,
        // xyneId leads: it's what the chip shows and what people paste into chat.
        label: ticket.xyneId || ticket.title || 'Untitled ticket',
        subtitle: ticket.xyneId ? ticket.title : null,
        icon: <TicketToken className='size-3.5 text-muted-foreground' aria-hidden='true' />,
        disabled: isUpdating,
      })),
    [isUpdating, searchResults],
  );

  /* The channel thread — where the rest of the app opens tickets; the
     `/projects/:projectId/:boardId/:ticketId` route drops the channel context. */
  const ticketHref =
    linkedTicket?.channelId && linkedTicket.conversationId
      ? `/chat/dir/${linkedTicket.channelId}/${linkedTicket.conversationId}/${linkedTicket.id}?selectedTab=details`
      : null;

  const handleSelect = (ticketId: string | null): void => {
    if (isUpdating) return;

    if (!ticketId) {
      onChange(null);
      return;
    }

    const ticket = searchResults?.find(candidate => candidate.id === ticketId);
    if (!ticket) return;

    onChange(ticketId, {
      id: ticket.id,
      label: ticket.xyneId || ticket.title || 'Untitled ticket',
    });
    setIsOpen(false);
    setSearch('');
  };

  if (linkedTicketId) {
    // Show the chip even when the ticket is hidden: hiding it would make a linked
    // recording look unlinked. Ticket access is granted in the ticketing system,
    // so saying so is all this can offer.
    if (isTicketDenied) {
      return (
        <span className={`${CHIP_CLASS_NAME} text-muted-foreground`}>
          <TicketToken className='size-3.5 shrink-0' aria-hidden='true' />
          <Tooltip content="Linked to a ticket you don't have access to" side='top'>
            <span className='max-w-40 truncate'>Private ticket</span>
          </Tooltip>
          {/* Unlinking is a recording action, not a ticket one — an editor may
              detach a ticket they cannot open (PRD §11.2). */}
          {canEdit && (
            <button
              type='button'
              onClick={() => onChange(null)}
              disabled={isUpdating}
              className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              aria-label='Unlink ticket'
              data-track-category='RecordingDetailV2'
              data-track-name='unlink_ticket'
            >
              <X className='size-3' aria-hidden='true' />
            </button>
          )}
        </span>
      );
    }

    // Still resolving — a frame or two off the local cache. Better a gap than a
    // chip that flips from "Private ticket" to a name.
    if (!linkedTicket) return null;

    const label = linkedTicket.xyneId || linkedTicket.title || 'Untitled ticket';

    return (
      <span className={CHIP_CLASS_NAME}>
        <TicketToken className='size-3.5 shrink-0 text-muted-foreground' aria-hidden='true' />
        <Tooltip content={linkedTicket.title || label} side='top'>
          {/* A ticket with no channel thread has nowhere to open — still worth
              naming, just not as a link. */}
          {ticketHref ? (
            <Link
              to={ticketHref}
              className='max-w-40 truncate transition-colors hover:text-muted-foreground'
              data-track-category='RecordingDetailV2'
              data-track-name='open_linked_ticket'
            >
              {label}
            </Link>
          ) : (
            <span className='max-w-40 truncate'>{label}</span>
          )}
        </Tooltip>
        {canEdit && (
          <button
            type='button'
            onClick={() => onChange(null)}
            disabled={isUpdating}
            className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            aria-label={`Unlink ticket ${label}`}
            data-track-category='RecordingDetailV2'
            data-track-name='unlink_ticket'
          >
            <X className='size-3' aria-hidden='true' />
          </button>
        )}
      </span>
    );
  }

  // Nothing linked and no way to link — don't show an affordance that only refuses.
  if (!canEdit) return null;

  return (
    <EntitySelector
      options={options}
      selectedValue={null}
      onSelect={handleSelect}
      placeholder='Link'
      searchPlaceholder='Search by ID or title'
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      onSearchChange={setSearch}
      // The query starts with the popover, so the first frame has no rows yet.
      isLoading={isOpen && !searchResults}
      // `ticketsSearch` already filtered server-side; doing it again would hide
      // rows the server deliberately returned.
      disableClientFiltering
      showIndicator={false}
      inputIcon={<LinkChainSlant className='size-3.5' aria-hidden='true' />}
      inputClassName='h-6 gap-1.5 rounded-lg border border-dashed border-muted-foreground/40 px-3 text-xs font-normal text-muted-foreground hover:border-foreground/30 hover:text-foreground'
      testId='recording-ticket-link'
    />
  );
}
