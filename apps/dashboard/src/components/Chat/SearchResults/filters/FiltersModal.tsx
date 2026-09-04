/**
 * The "Filter by" modal. Every field is rendered from the filter registry — `entriesFor`
 * decides which apply to the active type, and each entry's `control` picks the widget — so
 * a new filter appears here without touching this file.
 */
import { ReactElement, useState, useMemo, useEffect } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { useUsers } from '../../../../hooks/useUsers';
import { useAllVisibleChannels } from '../../../../hooks/useChannels';
import { getUserDisplayName } from '../../../../utils/userDisplayName';
import { Button } from '../../../ui/Button';
import { cn } from '../../../../utils/classNames';
import { Dialog } from '../../../ui/Dialog';
import { Checkbox } from '../../../ui/Checkbox/Checkbox';
import {
  DEFAULT_SEARCH_FILTERS,
  type SearchResultsFilters,
} from '../../../../hooks/useSearchResultsScreen';
import {
  DATE_RANGE_OPTIONS,
  countActiveFilters,
  entriesFor,
  type FilterEntry,
  type FilterResolvers,
} from '../../../../search/filterRegistry';
import {
  BoardTokenField,
  ChannelTokenField,
  MentionTargetsField,
  PeopleTokenField,
  SelectField,
  toggleIn,
} from './fields';
import { CHECK_GRID, CHECK_LABEL, CHIP_ACTIVE, CHIP_BASE, FIELD_BOX, FIELD_LABEL } from './styles';
import {
  DATE_MODES,
  DateModeDialog,
  dateModeFor,
  describeDateBounds,
  type DateMode,
} from './DateModeDialog';

/**
 * "Filter by" — every filter that isn't a standalone bar chip, in one flat modal.
 *
 * Edits are staged in a draft and only applied on Search, so a half-built filter set never
 * fires a query; the X (or Escape) discards them. Sections whose type can't express them
 * are hidden, matching how the query is actually built.
 */
export function FiltersModal({
  filters,
  onFiltersChange,
  open,
  onOpenChange,
}: {
  filters: SearchResultsFilters;
  onFiltersChange: (filters: SearchResultsFilters) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const [draft, setDraft] = useState<SearchResultsFilters>(filters);
  // Text controls stay uncommitted while typing, keyed by entry id.
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({});
  const [dateMode, setDateMode] = useState<DateMode | ''>('');
  const [pendingDateMode, setPendingDateMode] = useState<DateMode | null>(null);

  const draftCount = countActiveFilters(draft);

  const patch = (next: Partial<SearchResultsFilters>): void =>
    setDraft(prev => ({ ...prev, ...next }));

  // Start each open from what's actually applied — a previous cancel must not leak in.
  useEffect(() => {
    if (!open) return;
    setDraft(filters);
    setTextDrafts({});
    setDateMode(dateModeFor(filters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsedList = (raw: string): string[] =>
    raw
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

  const applyAndClose = (): void => {
    // Commit anything still sitting in a text control rather than dropping it.
    const pendingText = fieldEntries
      .filter(e => e.control?.kind === 'text' && textDrafts[e.id] !== undefined)
      .reduce(
        (acc, e) => ({ ...acc, ...(e.setValue?.(parsedList(textDrafts[e.id] ?? '')) ?? {}) }),
        {},
      );
    onFiltersChange({ ...draft, ...pendingText });
    onOpenChange(false);
  };

  const clearFilters = (): void => {
    setDraft(prev => ({
      ...prev,
      assigneeIds: [],
      withUserIds: [],
      fromUserIds: [],
      fromEmails: [],
      toEmails: [],
      inChannelIds: [],
      mentionUserIds: [],
      mentionChannelIds: [],
      statuses: [],
      priority: '',
      boardIds: [],
      tags: [],
      dateRange: '',
      after: '',
      before: '',
      onlyMyChannels: DEFAULT_SEARCH_FILTERS.onlyMyChannels,
      includeBotMessages: false,
    }));
    setTextDrafts({});
    setDateMode('');
  };

  const allUsers = useUsers();
  const allChannels = useAllVisibleChannels();
  // Only needed for the carried chips, which name users/channels the palette handed over.
  const chipResolvers = useMemo(
    (): FilterResolvers => ({
      userName: id => {
        const user = allUsers.find(u => u.id === id);
        return user ? getUserDisplayName(user) : undefined;
      },
      channelName: id => allChannels.find(c => c.id === id)?.name,
    }),
    [allUsers, allChannels],
  );

  // Counts what's applied, not what's drafted — the badge describes the live search.
  const appliedCount = countActiveFilters(filters);

  // The registry decides what this modal contains; the switch below only knows how to
  // render each *kind* of control, never an individual filter.
  const visible = entriesFor(draft.docType);
  // Toggles are excluded: each has its own pill in the filter bar, and a control that
  // exists in two places invites the two to disagree about which one you last touched.
  const fieldEntries = visible.filter(e => e.control && e.control.kind !== 'toggle');
  const carriedTokens = visible
    .filter(e => !e.control && e.isActive(draft))
    .flatMap(e => e.tokens?.(draft, chipResolvers) ?? []);

  const renderControl = (entry: FilterEntry): ReactElement | null => {
    const control = entry.control;
    if (!control) return null;
    const value = entry.getValue?.(draft);
    const write = (next: string[] | string | boolean): void => patch(entry.setValue?.(next) ?? {});
    const list = Array.isArray(value) ? value : [];

    switch (control.kind) {
      case 'people':
        return (
          <PeopleTokenField
            selected={list}
            onChange={write}
            placeholder={control.placeholder}
            track={entry.id.toUpperCase()}
          />
        );
      case 'channels':
        return (
          <ChannelTokenField
            selected={list}
            onChange={write}
            placeholder={control.placeholder}
            track={entry.id.toUpperCase()}
            excludeDMs={control.excludeDMs ?? false}
          />
        );
      case 'mentions':
        return (
          <MentionTargetsField
            users={draft.mentionUserIds}
            channels={draft.mentionChannelIds}
            onChange={next =>
              patch({ mentionUserIds: next.users, mentionChannelIds: next.channels })
            }
            placeholder={control.placeholder}
            track={entry.id.toUpperCase()}
          />
        );
      case 'boards':
        return <BoardTokenField selected={list} onChange={write} track={entry.id.toUpperCase()} />;
      case 'enumMulti':
        return (
          <div className={CHECK_GRID}>
            {control.options.map(opt => (
              <div key={opt.value} className='py-[2px]'>
                <Checkbox
                  checked={list.includes(opt.value)}
                  onChange={() => write(toggleIn(list, opt.value))}
                  label={opt.label}
                  labelClassName={CHECK_LABEL}
                />
              </div>
            ))}
          </div>
        );
      case 'enumSingle':
        return (
          <SelectField
            id={`filter-${entry.id}`}
            value={typeof value === 'string' ? value : ''}
            options={control.options}
            placeholder={control.anyLabel}
            onPick={write}
            track={entry.id.toUpperCase()}
          />
        );
      case 'text':
        return (
          <input
            id={`filter-${entry.id}`}
            value={textDrafts[entry.id] ?? list.join(', ')}
            onChange={e => setTextDrafts(prev => ({ ...prev, [entry.id]: e.target.value }))}
            onBlur={() => write(parsedList(textDrafts[entry.id] ?? ''))}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                write(parsedList(textDrafts[entry.id] ?? ''));
              }
            }}
            placeholder={control.placeholder}
            className={FIELD_BOX}
            data-track-category='SEARCH_FILTERS'
            data-track-name={`${entry.id.toUpperCase()}_INPUT`}
          />
        );
      case 'date':
        return (
          <>
            <SelectField
              id={`filter-${entry.id}`}
              value={dateMode || draft.dateRange}
              options={[...DATE_RANGE_OPTIONS, ...DATE_MODES]}
              placeholder='Any time'
              onPick={picked => {
                const asMode = DATE_MODES.find(m => m.value === picked)?.value ?? '';
                // A preset and explicit bounds are alternatives, never a combination:
                // picking either clears the other. A mode opens its date sheet, which
                // only writes back on Save.
                if (asMode) setPendingDateMode(asMode);
                else {
                  setDateMode('');
                  patch({ dateRange: picked, after: '', before: '' });
                }
              }}
              track='DATE_RANGE'
            />
            {(draft.after || draft.before) && (
              <button
                type='button'
                onClick={() => setPendingDateMode(dateModeFor(draft) || '__range__')}
                className={cn(FIELD_BOX, 'mt-2')}
                data-track-category='SEARCH_FILTERS'
                data-track-name='EDIT_DATE_MODE'
              >
                {describeDateBounds(draft.after, draft.before)}
              </button>
            )}
            {pendingDateMode && (
              <DateModeDialog
                mode={pendingDateMode}
                initial={{ after: draft.after, before: draft.before }}
                onCancel={() => setPendingDateMode(null)}
                onSave={next => {
                  setDateMode(pendingDateMode);
                  patch({ ...next, dateRange: '' });
                  setPendingDateMode(null);
                }}
              />
            )}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Filter by'
      className='flex max-h-[660px] max-w-[460px] flex-col overflow-hidden'
      trigger={
        <Button
          variant='outline'
          size='sm'
          className={cn(CHIP_BASE, appliedCount > 0 && CHIP_ACTIVE)}
          data-track-category='SEARCH_FILTERS'
          data-track-name='OPEN_FILTERS'
        >
          <SlidersHorizontal className='size-3' />
          Filters
          {appliedCount > 0 && (
            <span className='ml-0.5 rounded-full bg-primary-foreground/20 px-1.5 text-[10px] leading-4'>
              {appliedCount}
            </span>
          )}
        </Button>
      }
    >
      <div className='flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5'>
        <h2 className='text-base font-bold'>Filter by</h2>
        <button
          type='button'
          onClick={() => onOpenChange(false)}
          className='rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground'
          aria-label='Close filters'
          data-track-category='SEARCH_FILTERS'
          data-track-name='CLOSE_FILTERS'
        >
          <X className='size-4' />
        </button>
      </div>

      <div className='flex-1 space-y-4 overflow-y-auto px-5 pb-[18px] pt-4'>
        {/* Fields in registry order — this component knows control kinds, not filters. */}
        {fieldEntries.map(entry => (
          <div key={entry.id}>
            <label className={FIELD_LABEL} htmlFor={`filter-${entry.id}`}>
              {entry.label}
            </label>
            {renderControl(entry)}
          </div>
        ))}

        {/* Filters the palette can hand over that have no control of their own. Shown only
            when set, and removable, so an active filter is never invisible. */}
        {carriedTokens.length > 0 && (
          <div>
            <span className={FIELD_LABEL}>From your search</span>
            <div className='flex flex-wrap gap-1'>
              {carriedTokens.map(token => (
                <CarriedChip
                  key={token.key}
                  label={token.label}
                  onRemove={() => patch(token.patch)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className='flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3'>
        <div className='flex gap-2'>
          {/* Always rendered so the footer keeps its shape — a button that appears on the
              first filter would shift Search out from under the cursor. */}
          <Button
            variant='outline'
            size='sm'
            onClick={clearFilters}
            disabled={draftCount === 0}
            className='h-8 rounded-lg text-[13px] font-medium'
            data-track-category='SEARCH_FILTERS'
            data-track-name='CLEAR_ALL_FILTERS'
          >
            {draftCount > 0 ? `Clear filters (${draftCount})` : 'Clear filters'}
          </Button>
          <Button
            size='sm'
            onClick={applyAndClose}
            className='h-8 rounded-lg text-[13px] font-medium'
            data-track-category='SEARCH_FILTERS'
            data-track-name='APPLY_FILTERS'
          >
            Search
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function CarriedChip({ label, onRemove }: { label: string; onRemove: () => void }): ReactElement {
  return (
    <span className='inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs'>
      <span className='truncate max-w-[140px]'>{label}</span>
      <button
        onClick={onRemove}
        className='text-muted-foreground hover:text-foreground'
        data-track-category='SEARCH_FILTERS'
        data-track-name='REMOVE_CARRIED_CHIP'
      >
        <X className='size-3' />
      </button>
    </span>
  );
}
