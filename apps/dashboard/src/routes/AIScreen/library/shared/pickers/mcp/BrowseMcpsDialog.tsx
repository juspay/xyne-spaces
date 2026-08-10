import { Fragment, useMemo, useState, type ReactElement } from 'react';
import { cn } from '@/utils/classNames';
import { BROWSE_CARD, BROWSE_CARD_IDLE, BROWSE_CARD_SELECTED } from '../../primitives/browseCard';
import { ChevronRight, MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import { AGENT_CATEGORIES } from '@/services/claw/agentCategory';
import { BrowseDialog, type FilterOption } from '../../primitives/BrowseDialog';
import { SectionHeading, Separator } from '../../primitives/Section';
import {
  disableEntry,
  enableEntry,
  isEntryEnabled,
  selectedTools,
  type McpCatalogEntry,
  type McpSelection,
} from './mcpCatalog';
import { McpChip } from './McpChip';
import { EnabledBadge, McpIdentity } from './McpIdentity';
import { McpDetailPanel } from './McpDetailPanel';
import type { SuggestedMcp } from './useMcpSuggestions';

const POPULAR_LIMIT = 4;

interface EntryState {
  enabled: boolean;
  selectedCount: number;
}

function matchesSearch(entry: McpCatalogEntry, query: string): boolean {
  if (!query) return true;
  if (`${entry.label} ${entry.description}`.toLowerCase().includes(query)) return true;
  return entry.tools.some(tool => tool.name.toLowerCase().replace(/_/g, ' ').includes(query));
}

function entrySummary(entry: McpCatalogEntry, state: EntryState): string {
  if (entry.description) return entry.description;
  if (!entry.selectable) return 'Connect this integration to load its tools';
  return state.enabled
    ? `${state.selectedCount} of ${entry.tools.length} tools selected`
    : `${entry.tools.length} tools available`;
}

const McpCard = ({
  entry,
  state,
  onOpen,
  onToggle,
}: {
  entry: McpCatalogEntry;
  state: EntryState;
  onOpen: () => void;
  onToggle: () => void;
}): ReactElement => (
  <div className='group relative min-w-0'>
    <button
      type='button'
      onClick={onOpen}
      data-track-category='Claw Agents'
      data-track-name='Create agent v2: open MCP detail'
      className={cn(BROWSE_CARD, state.enabled ? BROWSE_CARD_SELECTED : BROWSE_CARD_IDLE)}
    >
      <span className='flex w-full items-center justify-between gap-2'>
        <McpIdentity
          label={entry.label}
          iconType={entry.iconType}
          verified={entry.verified}
          {...(state.enabled ? { trailing: <EnabledBadge /> } : {})}
        />
        <span className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground'>
          <ChevronRight className='size-4' aria-hidden />
        </span>
      </span>
      <span className='w-full truncate text-xs leading-4 tracking-[-0.24px] text-muted-foreground'>
        {entrySummary(entry, state)}
      </span>
    </button>

    {entry.selectable && (
      <button
        type='button'
        onClick={onToggle}
        aria-label={`${state.enabled ? 'Remove' : 'Add'} ${entry.label}`}
        title={state.enabled ? `Remove ${entry.label}` : `Add all ${entry.label} tools`}
        data-track-category='Claw Agents'
        data-track-name='Create agent v2: quick toggle MCP'
        className='absolute right-11 top-4 flex size-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100'
      >
        {state.enabled ? (
          <MultipleCrossCancelDefault className='size-4' aria-hidden />
        ) : (
          <PlusDefault className='size-4' aria-hidden />
        )}
      </button>
    )}
  </div>
);

interface BrowseMcpsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: readonly McpCatalogEntry[];
  connectedServerIds: ReadonlySet<string>;
  loading: boolean;
  isError: boolean;
  onRetry: () => void;
  selection: McpSelection;
  onSelectionChange: (next: McpSelection) => void;
  suggested: readonly SuggestedMcp[];
}

export function BrowseMcpsDialog({
  open,
  onOpenChange,
  catalog,
  connectedServerIds,
  loading,
  isError,
  onRetry,
  selection,
  onSelectionChange,
  suggested,
}: BrowseMcpsDialogProps): ReactElement {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const openEntry = catalog.find(entry => entry.slug === openSlug) ?? null;

  const entryStates = useMemo(() => {
    const states = new Map<string, EntryState>();
    for (const entry of catalog) {
      const count = selectedTools(selection, entry).length;
      states.set(entry.slug, { enabled: count > 0, selectedCount: count });
    }
    return states;
  }, [catalog, selection]);

  const stateOf = (entry: McpCatalogEntry): EntryState =>
    entryStates.get(entry.slug) ?? { enabled: false, selectedCount: 0 };

  const q = query.trim().toLowerCase();
  const searchFiltered = useMemo(
    () => catalog.filter(entry => matchesSearch(entry, q)),
    [catalog, q],
  );

  const filterOptions = useMemo<readonly FilterOption[]>(
    () => [
      { id: null, label: 'All' },
      ...AGENT_CATEGORIES.filter(definition =>
        searchFiltered.some(entry => entry.category === definition.id),
      ).map(definition => ({ id: definition.id as string, label: definition.label })),
    ],
    [searchFiltered],
  );

  const effectiveCategory =
    category && filterOptions.some(option => option.id === category) ? category : null;

  const sections = useMemo(() => {
    const scoped = effectiveCategory
      ? searchFiltered.filter(entry => entry.category === effectiveCategory)
      : searchFiltered;

    const groups: Array<{ key: string; label: string; entries: McpCatalogEntry[] }> = [];

    if (!q && !effectiveCategory) {
      const popular = [...scoped]
        .filter(entry => entry.usageCount > 0)
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, POPULAR_LIMIT);
      if (popular.length > 0) groups.push({ key: 'popular', label: 'Popular', entries: popular });
    }

    for (const definition of AGENT_CATEGORIES) {
      const entries = scoped.filter(entry => entry.category === definition.id);
      if (entries.length > 0) groups.push({ key: definition.id, label: definition.label, entries });
    }
    return groups;
  }, [searchFiltered, effectiveCategory, q]);

  const selectedEntries = useMemo(
    () => catalog.filter(entry => isEntryEnabled(selection, entry)),
    [catalog, selection],
  );
  const suggestedChips = useMemo(
    () => suggested.filter(match => !isEntryEnabled(selection, match.entry)),
    [suggested, selection],
  );

  const toggleEntry = (entry: McpCatalogEntry): void =>
    onSelectionChange(
      isEntryEnabled(selection, entry)
        ? disableEntry(catalog, selection, entry)
        : enableEntry(catalog, selection, entry),
    );

  const hasChips = selectedEntries.length > 0 || suggestedChips.length > 0;

  return (
    <BrowseDialog
      open={open}
      onOpenChange={next => {
        onOpenChange(next);
        if (!next) setOpenSlug(null);
      }}
      title='Browse MCPs'
      description='Search and select the MCP integrations this agent can use.'
      testId='browse-mcps-dialog'
      {...(openEntry && {
        detail: {
          label: openEntry.label,
          onBack: () => setOpenSlug(null),
          content: (
            <McpDetailPanel
              entry={openEntry}
              catalog={catalog}
              selection={selection}
              onSelectionChange={onSelectionChange}
              connected={!!openEntry.server && connectedServerIds.has(openEntry.server.id)}
            />
          ),
        },
      })}
      query={query}
      onQueryChange={setQuery}
      filterOptions={filterOptions}
      activeFilter={effectiveCategory}
      onFilterChange={setCategory}
      chips={
        hasChips ? (
          <div className='flex flex-wrap gap-2 px-2'>
            {selectedEntries.map(entry => (
              <McpChip
                key={`selected-${entry.slug}`}
                label={entry.label}
                iconType={entry.iconType}
                selected
                verified={entry.verified}
                onToggle={() => onSelectionChange(disableEntry(catalog, selection, entry))}
              />
            ))}
            {suggestedChips.map(match => (
              <McpChip
                key={`suggested-${match.entry.slug}`}
                label={match.entry.label}
                iconType={match.entry.iconType}
                selected={false}
                verified={match.entry.verified}
                onToggle={() =>
                  onSelectionChange(enableEntry(catalog, selection, match.entry, match.tools))
                }
              />
            ))}
          </div>
        ) : null
      }
      loading={loading}
      isError={isError}
      onRetry={onRetry}
      emptyMessage={
        sections.length === 0
          ? q
            ? `No integrations match “${query.trim()}”.`
            : 'No integrations available yet.'
          : null
      }
    >
      {sections.map((section, index) => (
        <Fragment key={section.key}>
          {index > 0 && <Separator className='px-2.5' />}
          <section className='flex flex-col gap-2'>
            <SectionHeading label={section.label} className='px-2.5' />
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              {section.entries.map(entry => (
                <McpCard
                  key={`${section.key}-${entry.slug}`}
                  entry={entry}
                  state={stateOf(entry)}
                  onOpen={() => setOpenSlug(entry.slug)}
                  onToggle={() => toggleEntry(entry)}
                />
              ))}
            </div>
          </section>
        </Fragment>
      ))}
    </BrowseDialog>
  );
}
