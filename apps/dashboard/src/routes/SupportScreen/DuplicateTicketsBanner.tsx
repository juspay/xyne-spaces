import { ReactElement, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TicketReferenceRelation } from '@xyne/shared';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  MultipleCrossCancelDefault as X,
} from '@xyne/icons';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import {
  formatIncomingReferenceLabel,
  formatReferenceLabel,
} from '../../hooks/useTicketReferences';
import { Badge } from '../../components/ui/Badge/Badge';

interface DuplicateTicketsBannerProps {
  /** DB ticket id (not xyneId) — `ticketByIdV2` keys on the primary key. */
  ticketId: string | null;
}

interface DuplicateEntry {
  referenceId: string;
  label: string;
  xyneId: string;
  title: string;
  channelId: string;
}

const DUPLICATE_RELATIONS = new Set<string>([
  TicketReferenceRelation.DUPLICATE_POSSIBLE,
  TicketReferenceRelation.DUPLICATE_CONFIRMED,
]);

const DuplicateTicketsBanner = ({ ticketId }: DuplicateTicketsBannerProps): ReactElement | null => {
  const [ticket] = useCachedQuery(queries.ticketByIdV2({ ticketId: ticketId ?? '' }), {
    enabled: !!ticketId,
  });

  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Dismissal is per-view, not persisted — reopening the ticket surfaces it
  // again. This component stays mounted as the agent moves between tickets.
  useEffect(() => {
    setIsDismissed(false);
    setIsExpanded(false);
  }, [ticketId]);

  const duplicates = useMemo<DuplicateEntry[]>(() => {
    if (!ticket) return [];

    const entries: DuplicateEntry[] = [];

    const push = (
      reference: { id: string; relationType: string },
      related: { xyneId?: string; title?: string; channelId?: string } | null | undefined,
      label: string,
    ): void => {
      if (!related?.channelId || !related.xyneId) return;
      entries.push({
        referenceId: reference.id,
        label,
        xyneId: related.xyneId,
        title: related.title || related.xyneId,
        channelId: related.channelId,
      });
    };

    // Outgoing: this ticket was flagged as a duplicate of an earlier one.
    for (const reference of ticket.referencesOut ?? []) {
      if (!DUPLICATE_RELATIONS.has(reference.relationType)) continue;
      push(reference, reference.targetTicket, formatReferenceLabel(reference.relationType));
    }

    // Incoming: later tickets were flagged as duplicates of this one.
    for (const reference of ticket.referencesIn ?? []) {
      if (!DUPLICATE_RELATIONS.has(reference.relationType)) continue;
      push(reference, reference.sourceTicket, formatIncomingReferenceLabel(reference.relationType));
    }

    return entries;
  }, [ticket]);

  if (isDismissed || duplicates.length === 0) return null;

  return (
    <div
      data-slot='desk-duplicate-banner'
      className='border-t border-amber-500/30 bg-amber-500/10 text-amber-800 dark:border-amber-500/40 dark:text-amber-300'
    >
      <div className='flex items-center gap-2 px-6 py-2'>
        <AlertTriangle className='size-4 shrink-0' />
        <button
          type='button'
          onClick={() => setIsExpanded(prev => !prev)}
          className='flex flex-1 items-center gap-2 text-left text-sm font-medium'
          data-track-category='Support'
          data-track-name='ToggleDuplicateBanner'
        >
          {duplicates.length} possible duplicate{duplicates.length === 1 ? '' : 's'}
          {isExpanded ? <ChevronDown className='size-4' /> : <ChevronUp className='size-4' />}
        </button>
        <button
          type='button'
          onClick={() => setIsDismissed(true)}
          aria-label='Dismiss duplicate warning'
          className='-mr-1 flex size-5 shrink-0 items-center justify-center rounded-md hover:bg-amber-500/20'
          data-track-category='Support'
          data-track-name='DismissDuplicateBanner'
        >
          <X className='size-3' />
        </button>
      </div>

      {isExpanded && (
        <ul className='max-h-48 overflow-y-auto border-t border-amber-500/30 px-6 py-2'>
          {duplicates.map(entry => (
            <li key={entry.referenceId}>
              <Link
                to={`/support/${entry.channelId}/${entry.xyneId}`}
                state={{ trackSource: 'duplicate_banner' }}
                className='flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-amber-500/10'
                data-track-category='Support'
                data-track-name='NavigateToDuplicateTicket'
              >
                <Badge variant='outline' className='shrink-0'>
                  {entry.label}
                </Badge>
                <span className='shrink-0 font-mono text-xs text-muted-foreground'>
                  {entry.xyneId}
                </span>
                <span className='min-w-0 truncate text-sm text-foreground'>{entry.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default DuplicateTicketsBanner;
