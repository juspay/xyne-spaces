import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Popover } from '../../ui/Popover';
import {
  ChevronLeft,
  FilterLines,
  MultipleCrossCancelDefault,
  SparkleAi01,
  Tag as TagIcon,
  UserDefault,
  UserTwo,
} from '@xyne/icons';
import type { TicketStatusV2 } from '@xyne/shared';
import type { TicketFilters } from '../../Tickets/TicketFilters/types';
import {
  AICategorySubmenu,
  GeneratedTagsSubmenu,
  PrioritySubmenu,
  StagesSubmenu,
  UserGroupSubmenu,
  UserSubmenu,
} from '../../Tickets/TicketFilters/Submenus';

/**
 * Filter bar for Topics Explorer. Reuses Desk's own filter submenus rather than
 * re-implementing pickers, so field list, search behaviour and value formats
 * (notably the `"category:tag"` composite for AI tags) match the ticket list.
 */

type FilterId = 'aiCategory' | 'generatedTags' | 'priority' | 'stages' | 'assignee' | 'userGroups';

const MENU: { id: FilterId; label: string; icon: typeof SparkleAi01 }[] = [
  { id: 'aiCategory', label: 'AI Category', icon: SparkleAi01 },
  { id: 'generatedTags', label: 'AI Tags & Sentiment', icon: TagIcon },
  { id: 'priority', label: 'Priority', icon: FilterLines },
  { id: 'stages', label: 'Stage', icon: FilterLines },
  { id: 'assignee', label: 'Assignee', icon: UserDefault },
  { id: 'userGroups', label: 'Team', icon: UserTwo },
];

/**
 * Selected values for a filter. Every `FilterId` is deliberately the
 * TicketFilters key it reads, so this is a plain lookup; `priority` is a
 * string-enum array, hence the cast.
 */
const selectedFor = (filters: TicketFilters, id: FilterId): string[] =>
  (filters[id] ?? []) as unknown as string[];

/** Filters whose values are opaque ids: their chips show a count, not a raw uuid. */
const ID_VALUED = new Set<FilterId>(['assignee', 'userGroups']);

export interface TopicsFilterBarProps {
  channelId: string;
  filters: TicketFilters;
  onChange: (filters: TicketFilters) => void;
  availableAiCategories: string[];
  availableStages: { name: string; status?: TicketStatusV2 }[];
  /** True while the window's AI tags are loading, so the tag filter cannot apply yet. */
  isLoadingTags?: boolean;
}

export const TopicsFilterBar = ({
  channelId,
  filters,
  onChange,
  availableAiCategories,
  availableStages,
  isLoadingTags,
}: TopicsFilterBarProps): ReactElement => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<FilterId | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);

  // Opening a submenu replaces the items that had focus, stranding keyboard
  // users outside the popover.
  useEffect(() => {
    if (active) backRef.current?.focus();
  }, [active]);

  const activeChips = MENU.filter(item => selectedFor(filters, item.id).length > 0);

  const clear = (id: FilterId): void => {
    const next = { ...filters };
    delete next[id];
    onChange(next);
  };

  const renderSubmenu = (): ReactElement | null => {
    switch (active) {
      case 'aiCategory':
        return (
          <AICategorySubmenu
            selectedCategories={filters.aiCategory ?? []}
            onChange={v => onChange({ ...filters, aiCategory: v })}
            availableCategories={availableAiCategories}
          />
        );
      case 'generatedTags':
        return (
          <GeneratedTagsSubmenu
            selectedTags={filters.generatedTags ?? []}
            onChange={v => onChange({ ...filters, generatedTags: v })}
            channelId={channelId}
          />
        );
      case 'priority':
        return (
          <PrioritySubmenu
            selectedPriorities={filters.priority ?? []}
            onChange={v => onChange({ ...filters, priority: v })}
          />
        );
      case 'stages':
        return (
          <StagesSubmenu
            selectedStages={filters.stages ?? []}
            onChange={v => onChange({ ...filters, stages: v })}
            availableStages={availableStages}
          />
        );
      case 'assignee':
        return (
          <UserSubmenu
            selectedUsers={filters.assignee ?? []}
            onChange={v => onChange({ ...filters, assignee: v })}
            label='Assignee'
            includeUnassigned
            channelId={channelId}
          />
        );
      case 'userGroups':
        return (
          <UserGroupSubmenu
            selectedGroups={filters.userGroups ?? []}
            onChange={v => onChange({ ...filters, userGroups: v })}
            onClose={() => setActive(null)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Popover
        open={open}
        onOpenChange={next => {
          setOpen(next);
          if (!next) setActive(null);
        }}
        align='start'
        sideOffset={6}
        collisionPadding={8}
        className='z-[10000] min-w-[220px] rounded-lg border border-border bg-popover p-1 shadow-xl'
        trigger={
          <button
            type='button'
            className='flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground'
            aria-label={`Filter${activeChips.length ? `, ${activeChips.length} active` : ''}`}
            data-track-category='TOPICS_EXPLORER'
            data-track-name='OPEN_FILTERS'
          >
            <FilterLines size={14} />
            Filter
          </button>
        }
      >
        {active ? (
          <>
            <button
              ref={backRef}
              type='button'
              onClick={() => setActive(null)}
              className='mb-1 flex w-full items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground'
              data-track-category='TOPICS_EXPLORER'
              data-track-name='FILTER_BACK'
            >
              <ChevronLeft size={13} />
              {MENU.find(m => m.id === active)?.label}
            </button>
            {renderSubmenu()}
          </>
        ) : (
          MENU.map(item => {
            const count = selectedFor(filters, item.id).length;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type='button'
                onClick={() => setActive(item.id)}
                className='flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent'
                data-track-category='TOPICS_EXPLORER'
                data-track-name='OPEN_FILTER_SUBMENU'
              >
                <Icon size={14} className='text-muted-foreground' />
                <span className='flex-1 text-left'>{item.label}</span>
                {count > 0 && <span className='text-xs text-muted-foreground'>{count}</span>}
              </button>
            );
          })
        )}
      </Popover>

      {activeChips.map(item => {
        const values = selectedFor(filters, item.id);
        const opaque = ID_VALUED.has(item.id);
        // The value truncates at 160px, so the full selection needs a tooltip.
        const summary =
          values.length === 1 && !opaque ? (values[0] ?? '') : `${values.length} selected`;
        return (
          <span
            key={item.id}
            className='flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs'
            title={opaque ? `${item.label}: ${summary}` : `${item.label}: ${values.join(', ')}`}
          >
            <span className='text-muted-foreground'>{item.label}</span>
            <span className='max-w-[160px] truncate font-medium'>{summary}</span>
            <button
              type='button'
              onClick={() => clear(item.id)}
              className='text-muted-foreground hover:text-foreground'
              aria-label={`Clear ${item.label} filter`}
              data-track-category='TOPICS_EXPLORER'
              data-track-name='CLEAR_ONE_FILTER'
            >
              <MultipleCrossCancelDefault size={12} />
            </button>
          </span>
        );
      })}

      {activeChips.length > 0 && (
        <button
          type='button'
          onClick={() => onChange({})}
          className='text-xs text-muted-foreground underline hover:text-foreground'
          data-track-category='TOPICS_EXPLORER'
          data-track-name='CLEAR_FILTERS'
        >
          Clear all
        </button>
      )}

      {isLoadingTags && <span className='text-xs text-muted-foreground'>Loading tags…</span>}
    </div>
  );
};
