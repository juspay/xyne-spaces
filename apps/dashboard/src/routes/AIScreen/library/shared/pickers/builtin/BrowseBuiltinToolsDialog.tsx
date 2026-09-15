import { useMemo, useState, type ReactElement } from 'react';
import { cn } from '@/utils/classNames';
import { searchByNameThenDescription } from '../../librarySearch';
import { BROWSE_CARD, BROWSE_CARD_IDLE, BROWSE_CARD_SELECTED } from '../../primitives/browseCard';
import { ChevronRight, MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import {
  BrowseDialog,
  handleBrowseDialogOpenChange,
  type FilterOption,
} from '../../primitives/BrowseDialog';
import { Pill } from '../../primitives/Pill';
import { BuiltinChip } from './BuiltinChip';
import { BuiltinDetailPanel } from './BuiltinDetailPanel';
import {
  disableEntry,
  enableEntry,
  isEntryEnabled,
  selectedTools,
  type BuiltinCatalogEntry,
  type BuiltinSelection,
} from './builtinCatalog';
import type { SuggestedBuiltin } from './useBuiltinSuggestions';

const FILTER_OPTIONS: readonly FilterOption[] = [
  { id: null, label: 'All' },
  { id: 'read', label: 'Read only' },
  { id: 'write', label: 'Write' },
  { id: 'destructive', label: 'Destructive' },
];

const RISK_LABEL = { read: 'Read', write: 'Write', destructive: 'Destructive' } as const;
const RISK_TONE = { read: 'success', write: 'warning', destructive: 'danger' } as const;

function builtinSearchFields(entry: BuiltinCatalogEntry) {
  return {
    name: entry.label,
    extras: entry.tools.map(tool => tool.name.replace(/_/g, ' ')),
  };
}

const BuiltinCard = ({
  entry,
  enabled,
  selectedCount,
  onOpen,
  onToggle,
}: {
  entry: BuiltinCatalogEntry;
  enabled: boolean;
  selectedCount: number;
  onOpen: () => void;
  onToggle: () => void;
}): ReactElement => (
  <div className='group relative min-w-0'>
    <button
      type='button'
      onClick={onOpen}
      data-track-category='Claw Agents'
      data-track-name='Create agent v2: open built-in detail'
      className={cn(BROWSE_CARD, enabled ? BROWSE_CARD_SELECTED : BROWSE_CARD_IDLE)}
    >
      <span className='flex w-full items-center justify-between gap-2'>
        <span className='flex min-w-0 items-center gap-2'>
          <span className='truncate text-sm font-medium leading-5 text-foreground'>
            {entry.label}
          </span>
          {enabled ? (
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
        {enabled
          ? `${selectedCount} of ${entry.tools.length} tools selected`
          : `${entry.tools.length} tools available`}
      </span>
    </button>

    <button
      type='button'
      onClick={onToggle}
      aria-label={`${enabled ? 'Remove' : 'Add'} ${entry.label}`}
      title={enabled ? `Remove ${entry.label}` : `Add all ${entry.label} tools`}
      data-track-category='Claw Agents'
      data-track-name='Create agent v2: quick toggle built-in group'
      className='absolute right-11 top-4 flex size-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100'
    >
      {enabled ? (
        <MultipleCrossCancelDefault className='size-4' aria-hidden />
      ) : (
        <PlusDefault className='size-4' aria-hidden />
      )}
    </button>
  </div>
);

interface BrowseBuiltinToolsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: readonly BuiltinCatalogEntry[];
  loading: boolean;
  isError: boolean;
  onRetry: () => void;
  selection: BuiltinSelection;
  onSelectionChange: (next: BuiltinSelection) => void;
  suggested: readonly SuggestedBuiltin[];
}

export function BrowseBuiltinToolsDialog({
  open,
  onOpenChange,
  catalog,
  loading,
  isError,
  onRetry,
  selection,
  onSelectionChange,
  suggested,
}: BrowseBuiltinToolsDialogProps): ReactElement {
  const [query, setQuery] = useState('');
  const [risk, setRisk] = useState<string | null>(null);
  const [openSource, setOpenSource] = useState<string | null>(null);

  const openEntry = catalog.find(entry => entry.source === openSource) ?? null;

  const entryStates = useMemo(() => {
    const states = new Map<string, number>();
    for (const entry of catalog) states.set(entry.source, selectedTools(selection, entry).length);
    return states;
  }, [catalog, selection]);

  const q = query.trim();
  const visible = useMemo(
    () =>
      searchByNameThenDescription(catalog, q, builtinSearchFields).filter(
        entry => risk === null || entry.tools.some(tool => tool.riskLevel === risk),
      ),
    [catalog, q, risk],
  );

  const selectedEntries = useMemo(
    () => catalog.filter(entry => isEntryEnabled(selection, entry)),
    [catalog, selection],
  );
  const suggestedChips = useMemo(
    () => suggested.filter(match => !isEntryEnabled(selection, match.entry)),
    [suggested, selection],
  );

  const hasChips = selectedEntries.length > 0 || suggestedChips.length > 0;

  return (
    <BrowseDialog
      open={open}
      onOpenChange={next =>
        handleBrowseDialogOpenChange(next, onOpenChange, () => {
          setQuery('');
          setRisk(null);
          setOpenSource(null);
        })
      }
      title='Browse built in tools'
      description='Search and select the built-in tools this agent can use.'
      testId='browse-builtin-tools-dialog'
      {...(openEntry && {
        detail: {
          label: openEntry.label,
          onBack: () => setOpenSource(null),
          content: (
            <BuiltinDetailPanel
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
      activeFilter={risk}
      onFilterChange={setRisk}
      chips={
        hasChips ? (
          <div className='flex flex-wrap gap-2 px-2'>
            {selectedEntries.map(entry => (
              <BuiltinChip
                key={`selected-${entry.source}`}
                label={entry.label}
                selected
                onToggle={() => onSelectionChange(disableEntry(selection, entry))}
              />
            ))}
            {suggestedChips.map(match => (
              <BuiltinChip
                key={`suggested-${match.entry.source}`}
                label={match.entry.label}
                selected={false}
                onToggle={() => onSelectionChange(enableEntry(selection, match.entry, match.tools))}
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
            ? `No built-in tools match “${query.trim()}”.`
            : 'No built-in tools available yet.'
          : null
      }
    >
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        {visible.map(entry => (
          <BuiltinCard
            key={entry.source}
            entry={entry}
            enabled={isEntryEnabled(selection, entry)}
            selectedCount={entryStates.get(entry.source) ?? 0}
            onOpen={() => setOpenSource(entry.source)}
            onToggle={() =>
              onSelectionChange(
                isEntryEnabled(selection, entry)
                  ? disableEntry(selection, entry)
                  : enableEntry(selection, entry),
              )
            }
          />
        ))}
      </div>
    </BrowseDialog>
  );
}
