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
  /** Only the recording owner can link or unlink; everyone else sees it read-only. */
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
 * Links a recording to exactly one ticket.
 *
 * The picker is `EntitySelector` — the same single-select the ticket screen's
 * Related Tickets dropdown uses — so "only one ticket" is enforced by the
 * component contract (`selectedValue` is a single id) rather than by convention.
 *
 * Candidates come from Zero rather than Vespa: `ticketsSearch` is live, matches
 * on both xyneId and title, and is already scoped by `TicketsACL` to tickets the
 * viewer can see, so the picker cannot surface a ticket they have no access to.
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

  const [linkedRows] = useCachedQuery(
    queries.ticketsByIds({ ticketIds: linkedTicketId ? [linkedTicketId] : [] }),
    { enabled: !!linkedTicketId },
  );
  const linkedTicket = linkedRows?.[0] ?? null;

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

  /* A recording lives outside any project, so the ticket carries its own route. */
  const ticketHref = linkedTicket
    ? `/projects/${linkedTicket.projectId}/${linkedTicket.boardId}/${linkedTicket.id}`
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
    // Either the lookup hasn't resolved yet (a frame or two, since Zero answers
    // from the local cache) or it resolved to nothing — which is what a ticket
    // outside the viewer's ACL looks like. Neither is worth a dead chip.
    if (!linkedTicket || !ticketHref) return null;

    const label = linkedTicket.xyneId || linkedTicket.title || 'Untitled ticket';

    return (
      <span className={CHIP_CLASS_NAME}>
        <TicketToken className='size-3.5 shrink-0 text-muted-foreground' aria-hidden='true' />
        <Tooltip content={linkedTicket.title || label} side='top'>
          <Link
            to={ticketHref}
            className='max-w-40 truncate transition-colors hover:text-muted-foreground'
            data-track-category='RecordingDetailV2'
            data-track-name='open_linked_ticket'
          >
            {label}
          </Link>
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

  // Nothing linked and nothing to link with — a shared recording's header
  // shouldn't show an affordance that only refuses.
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
      // The query only runs once the popover is open, so the first frame has no
      // rows yet — say "loading" rather than showing an empty list.
      isLoading={isOpen && !searchResults}
      // `ticketsSearch` already applied the query server-side; filtering the page
      // again client-side would just hide rows the server deliberately returned.
      disableClientFiltering
      showIndicator={false}
      inputIcon={<LinkChainSlant className='size-3.5' aria-hidden='true' />}
      inputClassName='h-6 gap-1.5 rounded-lg border border-dashed border-muted-foreground/40 px-3 text-xs font-normal text-muted-foreground hover:border-foreground/30 hover:text-foreground'
      testId='recording-ticket-link'
    />
  );
}
