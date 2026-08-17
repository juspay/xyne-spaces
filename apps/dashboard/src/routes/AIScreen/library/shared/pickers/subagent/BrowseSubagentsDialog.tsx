import { useMemo, useState, type ReactElement } from 'react';
import { cn } from '@/utils/classNames';
import { BROWSE_CARD, BROWSE_CARD_IDLE, BROWSE_CARD_SELECTED } from '../../primitives/browseCard';
import { ChevronRight, MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import { BrowseDialog, type FilterOption } from '../../primitives/BrowseDialog';
import { Pill } from '../../primitives/Pill';
import { SubagentChip } from './SubagentChip';
import { SubagentDetailPanel } from './SubagentDetailPanel';
import {
  disableSubagent,
  isSubagentSelected,
  toggleSubagent,
  type SubagentCatalogEntry,
  type SubagentSelection,
} from './subagentCatalog';

const FILTER_OPTIONS: readonly FilterOption[] = [
  { id: null, label: 'All' },
  { id: 'builtin', label: 'Built-in' },
  { id: 'custom', label: 'Custom' },
];

const RISK_LABEL = {
  read: 'Read',
  write: 'Write',
  destructive: 'Destructive',
} as const;

const RISK_TONE = {
  read: 'success',
  write: 'warning',
  destructive: 'danger',
} as const;

function matchesSearch(entry: SubagentCatalogEntry, query: string): boolean {
  if (!query) return true;
  return `${entry.name} ${entry.description}`.toLowerCase().includes(query);
}

const SubagentCard = ({
  entry,
  selected,
  onOpen,
  onToggle,
}: {
  entry: SubagentCatalogEntry;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void;
}): ReactElement => (
  <div className='group relative min-w-0'>
    <button
      type='button'
      onClick={onOpen}
      data-track-category='Claw Agents'
      data-track-name='Create agent v2: open subagent detail'
      className={cn(BROWSE_CARD, selected ? BROWSE_CARD_SELECTED : BROWSE_CARD_IDLE)}
    >
      <span className='flex w-full items-center justify-between gap-2'>
        <span className='flex min-w-0 items-center gap-2'>
          <span className='truncate text-sm font-medium leading-5 text-foreground'>
            {entry.name}
          </span>
          {selected ? (
            <Pill tone='success' size='sm'>
              Enabled
            </Pill>
          ) : (
            <Pill tone={RISK_TONE[entry.risk]} size='sm'>
              {RISK_LABEL[entry.risk]}
            </Pill>
          )}
        </span>
        <span className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground'>
          <ChevronRight className='size-4' aria-hidden />
        </span>
      </span>
      <span className='w-full truncate text-xs leading-4 tracking-[-0.24px] text-muted-foreground'>
        {entry.description || 'No description added'}
      </span>
    </button>

    <button
      type='button'
      onClick={onToggle}
      aria-label={`${selected ? 'Remove' : 'Add'} ${entry.name}`}
      title={`${selected ? 'Remove' : 'Add'} ${entry.name}`}
      data-track-category='Claw Agents'
      data-track-name='Create agent v2: quick toggle subagent'
      className='absolute right-11 top-4 flex size-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100'
    >
      {selected ? (
        <MultipleCrossCancelDefault className='size-4' aria-hidden />
      ) : (
        <PlusDefault className='size-4' aria-hidden />
      )}
    </button>
  </div>
);

interface BrowseSubagentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: readonly SubagentCatalogEntry[];
  loading: boolean;
  isError: boolean;
  onRetry: () => void;
  selection: SubagentSelection;
  onSelectionChange: (next: SubagentSelection) => void;
  suggested: readonly SubagentCatalogEntry[];
}

export function BrowseSubagentsDialog({
  open,
  onOpenChange,
  catalog,
  loading,
  isError,
  onRetry,
  selection,
  onSelectionChange,
  suggested,
}: BrowseSubagentsDialogProps): ReactElement {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [openName, setOpenName] = useState<string | null>(null);

  const openEntry = catalog.find(entry => entry.name === openName) ?? null;

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      catalog.filter(
        entry => matchesSearch(entry, q) && (source === null || entry.source === source),
      ),
    [catalog, q, source],
  );

  const selectedEntries = useMemo(
    () => catalog.filter(entry => isSubagentSelected(selection, entry)),
    [catalog, selection],
  );
  const suggestedChips = useMemo(
    () => suggested.filter(entry => !isSubagentSelected(selection, entry)),
    [suggested, selection],
  );

  const hasChips = selectedEntries.length > 0 || suggestedChips.length > 0;

  return (
    <BrowseDialog
      open={open}
      onOpenChange={next => {
        onOpenChange(next);
        if (!next) setOpenName(null);
      }}
      title='Browse Subagent'
      description='Search and select the subagents this agent can delegate to.'
      testId='browse-subagents-dialog'
      {...(openEntry && {
        detail: {
          label: openEntry.name,
          onBack: () => setOpenName(null),
          content: (
            <SubagentDetailPanel
              entry={openEntry}
              selection={selection}
              onSelectionChange={onSelectionChange}
            />
          ),
        },
      })}
      query={query}
      onQueryChange={setQuery}
      filterOptions={FILTER_OPTIONS}
      activeFilter={source}
      onFilterChange={setSource}
      chips={
        hasChips ? (
          <div className='flex flex-wrap gap-2 px-2'>
            {selectedEntries.map(entry => (
              <SubagentChip
                key={`selected-${entry.name}`}
                label={entry.name}
                selected
                onToggle={() => onSelectionChange(disableSubagent(selection, entry))}
              />
            ))}
            {suggestedChips.map(entry => (
              <SubagentChip
                key={`suggested-${entry.name}`}
                label={entry.name}
                selected={false}
                onToggle={() => onSelectionChange(toggleSubagent(selection, entry))}
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
            ? `No subagents match “${query.trim()}”.`
            : 'No subagents available yet.'
          : null
      }
    >
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        {visible.map(entry => (
          <SubagentCard
            key={entry.name}
            entry={entry}
            selected={isSubagentSelected(selection, entry)}
            onOpen={() => setOpenName(entry.name)}
            onToggle={() => onSelectionChange(toggleSubagent(selection, entry))}
          />
        ))}
      </div>
    </BrowseDialog>
  );
}
