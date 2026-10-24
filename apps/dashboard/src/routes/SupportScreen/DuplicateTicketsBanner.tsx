import { ReactElement, ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TicketReferenceRelation } from '@xyne/shared';
import {
  AlertTriangle,
  BulbDefault,
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
import { cn } from '../../utils/classNames';

interface DuplicateTicketsBannerProps {
  /** DB ticket id (not xyneId) — `ticketByIdV2` keys on the primary key. */
  ticketId: string | null;
}

interface ReferenceEntry {
  referenceId: string;
  label: string;
  xyneId: string;
  title: string;
  channelId: string;
}

type Kind = 'duplicate' | 'related';

const DUPLICATE_RELATIONS = new Set<string>([
  TicketReferenceRelation.DUPLICATE_POSSIBLE,
  TicketReferenceRelation.DUPLICATE_CONFIRMED,
]);

type RelatedTicket = {
  xyneId?: string;
  title?: string;
  channelId?: string;
};

const toEntry = (
  reference: { id: string },
  related: RelatedTicket | null | undefined,
  label: string,
): ReferenceEntry | null => {
  if (!related?.channelId || !related.xyneId) return null;
  return {
    referenceId: reference.id,
    label,
    xyneId: related.xyneId,
    title: related.title || related.xyneId,
    channelId: related.channelId,
  };
};

const STRIP_STYLES: Record<Kind, { strip: string; hover: string; divider: string }> = {
  duplicate: {
    strip:
      'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
    hover: 'hover:bg-amber-500/20',
    divider: 'border-amber-500/30',
  },
  related: {
    strip: 'border-border bg-muted/40 text-muted-foreground',
    hover: 'hover:bg-muted',
    divider: 'border-border',
  },
};

interface ReferenceStripProps {
  kind: Kind;
  icon: ReactNode;
  summary: string;
  entries: ReferenceEntry[];
  isExpanded: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  dismissLabel: string;
  trackSuffix: string;
}

const ReferenceStrip = ({
  kind,
  icon,
  summary,
  entries,
  isExpanded,
  onToggle,
  onDismiss,
  dismissLabel,
  trackSuffix,
}: ReferenceStripProps): ReactElement => {
  const styles = STRIP_STYLES[kind];
  return (
    <div data-slot={`desk-${kind}-banner`} className={cn('border-t', styles.strip)}>
      <div className='flex items-center gap-2 px-6 py-2'>
        {icon}
        <button
          type='button'
          onClick={onToggle}
          className='flex flex-1 items-center gap-2 text-left text-sm font-medium'
          data-track-category='Support'
          data-track-name={`Toggle${trackSuffix}Banner`}
        >
          {summary}
          {isExpanded ? <ChevronDown className='size-4' /> : <ChevronUp className='size-4' />}
        </button>
        <button
          type='button'
          onClick={onDismiss}
          aria-label={dismissLabel}
          className={cn(
            '-mr-1 flex size-5 shrink-0 items-center justify-center rounded-md',
            styles.hover,
          )}
          data-track-category='Support'
          data-track-name={`Dismiss${trackSuffix}Banner`}
        >
          <X className='size-3' />
        </button>
      </div>

      {isExpanded && (
        <ul className={cn('max-h-48 overflow-y-auto border-t px-6 py-2', styles.divider)}>
          {entries.map(entry => (
            <li key={entry.referenceId}>
              <Link
                to={`/support/${entry.channelId}/${entry.xyneId}`}
                state={{ trackSource: `${kind}_banner` }}
                className={cn('flex items-center gap-3 rounded-md px-2 py-1.5', styles.hover)}
                data-track-category='Support'
                data-track-name={`NavigateTo${trackSuffix}Ticket`}
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

const DuplicateTicketsBanner = ({ ticketId }: DuplicateTicketsBannerProps): ReactElement | null => {
  const [ticket] = useCachedQuery(queries.ticketByIdV2({ ticketId: ticketId ?? '' }), {
    enabled: !!ticketId,
  });

  const [expanded, setExpanded] = useState<Kind | null>(null);
  const [dismissed, setDismissed] = useState<Record<Kind, boolean>>({
    duplicate: false,
    related: false,
  });

  // Dismissal is per-view, not persisted — reopening the ticket surfaces it
  // again. This component stays mounted as the agent moves between tickets.
  useEffect(() => {
    setDismissed({ duplicate: false, related: false });
    setExpanded(null);
  }, [ticketId]);

  const { duplicates, related } = useMemo(() => {
    const duplicateEntries: ReferenceEntry[] = [];
    const relatedEntries: ReferenceEntry[] = [];
    if (!ticket) return { duplicates: duplicateEntries, related: relatedEntries };

    const add = (
      reference: { id: string; relationType: TicketReferenceRelation },
      other: RelatedTicket | undefined,
      label: string,
    ): void => {
      const list = DUPLICATE_RELATIONS.has(reference.relationType)
        ? duplicateEntries
        : reference.relationType === TicketReferenceRelation.RELATED_POSSIBLE
          ? relatedEntries
          : null;
      const entry = list && toEntry(reference, other, label);
      // A ticket can be related both ways; list it once.
      if (entry && !list.some(existing => existing.xyneId === entry.xyneId)) list.push(entry);
    };

    // Outgoing: this ticket was flagged as a duplicate of an earlier one, or an earlier
    // ticket was found that could help resolve it. Incoming: the reverse.
    for (const reference of ticket.referencesOut ?? []) {
      add(
        reference,
        reference.targetTicket as RelatedTicket | undefined,
        formatReferenceLabel(reference.relationType),
      );
    }
    for (const reference of ticket.referencesIn ?? []) {
      add(
        reference,
        reference.sourceTicket as RelatedTicket | undefined,
        formatIncomingReferenceLabel(reference.relationType),
      );
    }

    return { duplicates: duplicateEntries, related: relatedEntries };
  }, [ticket]);

  const showDuplicates = !dismissed.duplicate && duplicates.length > 0;
  const showRelated = !dismissed.related && related.length > 0;
  if (!showDuplicates && !showRelated) return null;

  const toggle = (kind: Kind) => (): void => setExpanded(prev => (prev === kind ? null : kind));
  const dismiss = (kind: Kind) => (): void => setDismissed(prev => ({ ...prev, [kind]: true }));

  return (
    <>
      {showDuplicates && (
        <ReferenceStrip
          kind='duplicate'
          icon={<AlertTriangle className='size-4 shrink-0' />}
          summary={`${duplicates.length} possible duplicate${duplicates.length === 1 ? '' : 's'}`}
          entries={duplicates}
          isExpanded={expanded === 'duplicate'}
          onToggle={toggle('duplicate')}
          onDismiss={dismiss('duplicate')}
          dismissLabel='Dismiss duplicate warning'
          trackSuffix='Duplicate'
        />
      )}
      {showRelated && (
        <ReferenceStrip
          kind='related'
          icon={<BulbDefault className='size-4 shrink-0' />}
          summary={`${related.length} related ticket${related.length === 1 ? '' : 's'}`}
          entries={related}
          isExpanded={expanded === 'related'}
          onToggle={toggle('related')}
          onDismiss={dismiss('related')}
          dismissLabel='Dismiss related tickets'
          trackSuffix='Related'
        />
      )}
    </>
  );
};

export default DuplicateTicketsBanner;
