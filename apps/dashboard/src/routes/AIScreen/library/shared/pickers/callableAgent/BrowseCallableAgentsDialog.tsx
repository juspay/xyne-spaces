import { useMemo, useState, type ReactElement } from 'react';
import { ChevronRight, MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { searchByNameThenDescription } from '../../librarySearch';
import { BROWSE_CARD, BROWSE_CARD_IDLE, BROWSE_CARD_SELECTED } from '../../primitives/browseCard';
import {
  BrowseDialog,
  handleBrowseDialogOpenChange,
  type FilterOption,
} from '../../primitives/BrowseDialog';
import { Pill } from '../../primitives/Pill';
import { SubagentChip } from '../subagent/SubagentChip';
import { CallableAgentDetailPanel } from './CallableAgentDetailPanel';
import { statusPill, type CallableAgentEntry } from './callableAgentCatalog';

const FILTER_OPTIONS: readonly FilterOption[] = [
  { id: null, label: 'All' },
  { id: 'added', label: 'Added' },
  { id: 'available', label: 'Available' },
];

const CallableAgentCard = ({
  entry,
  onOpen,
  onToggle,
}: {
  entry: CallableAgentEntry;
  onOpen: () => void;
  onToggle: () => void;
}): ReactElement => {
  const pill = statusPill(entry.status);
  const selected = entry.status !== null;

  return (
    <div className='group relative min-w-0'>
      <button
        type='button'
        onClick={onOpen}
        data-track-category='Claw Agents'
        data-track-name='Create agent v2: open callable agent detail'
        className={cn(BROWSE_CARD, selected ? BROWSE_CARD_SELECTED : BROWSE_CARD_IDLE)}
      >
        <span className='flex w-full items-center justify-between gap-2'>
          <span className='flex min-w-0 items-center gap-2'>
            <span className='truncate text-sm font-medium leading-5 text-foreground'>
              {entry.name}
            </span>
            {pill ? (
              <Pill tone={pill.tone} size='sm'>
                {pill.label}
              </Pill>
            ) : entry.needsApproval ? (
              <Pill tone='neutral' size='sm'>
                Needs approval
              </Pill>
            ) : null}
          </span>
          <span className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground'>
            <ChevronRight className='size-4' aria-hidden />
          </span>
        </span>
        <span className='w-full truncate text-xs leading-4 tracking-[-0.24px] text-muted-foreground'>
          {entry.description || `@${entry.slug}`}
        </span>
      </button>

      {/* Quick toggle only removes, or adds an agent that needs no approval —
          a request that needs a reason has to go through the detail panel. */}
      {(selected || !entry.needsApproval) && (
        <button
          type='button'
          onClick={onToggle}
          aria-label={`${selected ? 'Remove' : 'Add'} ${entry.name}`}
          title={`${selected ? 'Remove' : 'Add'} ${entry.name}`}
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: quick toggle callable agent'
          className='absolute right-11 top-4 flex size-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100'
        >
          {selected ? (
            <MultipleCrossCancelDefault className='size-4' aria-hidden />
          ) : (
            <PlusDefault className='size-4' aria-hidden />
          )}
        </button>
      )}
    </div>
  );
};

interface BrowseCallableAgentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: readonly CallableAgentEntry[];
  loading: boolean;
  isError: boolean;
  onRetry: () => void;
  busySlug: string | null;
  onAdd: (slug: string, requestReason: string) => void;
  onRemove: (slug: string) => void;
}

export function BrowseCallableAgentsDialog({
  open,
  onOpenChange,
  catalog,
  loading,
  isError,
  onRetry,
  busySlug,
  onAdd,
  onRemove,
}: BrowseCallableAgentsDialogProps): ReactElement {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const openEntry = catalog.find(entry => entry.slug === openSlug) ?? null;
  const q = query.trim();

  const visible = useMemo(
    () =>
      searchByNameThenDescription(catalog, q, entry => ({
        name: entry.name,
        description: entry.description,
        ...(entry.slug && entry.slug !== entry.name ? { aliases: [entry.slug] as const } : {}),
      })).filter(entry => {
        if (filter === 'added') return entry.status !== null;
        if (filter === 'available') return entry.status === null;
        return true;
      }),
    [catalog, q, filter],
  );

  const addedEntries = useMemo(() => catalog.filter(entry => entry.status !== null), [catalog]);

  return (
    <BrowseDialog
      open={open}
      onOpenChange={next =>
        handleBrowseDialogOpenChange(next, onOpenChange, () => {
          setQuery('');
          setFilter(null);
          setOpenSlug(null);
        })
      }
      title='Browse Agents'
      description='Search and select the agents this agent can hand a task to.'
      testId='browse-callable-agents-dialog'
      {...(openEntry && {
        detail: {
          label: openEntry.name,
          onBack: () => setOpenSlug(null),
          content: (
            <CallableAgentDetailPanel
              entry={openEntry}
              busy={busySlug === openEntry.slug}
              onAdd={reason => {
                onAdd(openEntry.slug, reason);
                setOpenSlug(null);
              }}
              onRemove={() => {
                onRemove(openEntry.slug);
                setOpenSlug(null);
              }}
            />
          ),
        },
      })}
      query={query}
      onQueryChange={setQuery}
      filterOptions={FILTER_OPTIONS}
      activeFilter={filter}
      onFilterChange={setFilter}
      chips={
        addedEntries.length > 0 ? (
          <div className='flex flex-wrap gap-2 px-2'>
            {addedEntries.map(entry => (
              <SubagentChip
                key={`added-${entry.slug}`}
                label={entry.name}
                selected
                onToggle={() => onRemove(entry.slug)}
              />
            ))}
          </div>
        ) : null
      }
      loading={loading}
      isError={isError}
      onRetry={onRetry}
      emptyMessage={
        visible.length === 0
          ? q
            ? `No agents match “${query.trim()}”.`
            : 'No other agents available yet.'
          : null
      }
    >
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        {visible.map(entry => (
          <CallableAgentCard
            key={entry.slug}
            entry={entry}
            onOpen={() => setOpenSlug(entry.slug)}
            onToggle={() => (entry.status !== null ? onRemove(entry.slug) : onAdd(entry.slug, ''))}
          />
        ))}
      </div>
    </BrowseDialog>
  );
}
