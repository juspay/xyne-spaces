import { ReactElement, useState } from 'react';
import { Command } from 'cmdk';
import { Clock, X } from 'lucide-react';
import { usePlatform } from '../../../../hooks/usePlatform';
import { TabType } from '../ChannelCommandMenu.types';
import { QueryFilterChips } from '../QueryFilterChips';
import { identityKeyFor, recentSearchLabel, type RecentSearchEntry } from './storage';

/** Props for the empty-state recents list: the entries plus row select / remove / mouse-down handlers. */
export interface RecentSearchesProps {
  recents: RecentSearchEntry[];
  currentUserID: string;
  getTabLabel: (tab: TabType) => string;
  onSelect: (entry: RecentSearchEntry) => void;
  onRemove: (identityKey: string) => void;
  onItemMouseDown: (event: React.MouseEvent) => void;
}

const RECENTS_DISPLAY_LIMIT = 3; // rows shown before "See more"

/** Cmd+K empty-state recents: rows + inline "See more" and per-row hover-×. */
export function RecentSearches(props: RecentSearchesProps): ReactElement | null {
  const { recents, currentUserID, getTabLabel, onSelect, onRemove, onItemMouseDown } = props;
  const { isMobile } = usePlatform();
  // "See more" is ephemeral UI state of this widget — owned here, resets when it remounts.
  const [isExpanded, setIsExpanded] = useState(false);

  if (recents.length === 0) return null;

  const visibleRecents = isExpanded ? recents : recents.slice(0, RECENTS_DISPLAY_LIMIT);
  const hasMore = recents.length > RECENTS_DISPLAY_LIMIT;
  const hiddenCount = recents.length - RECENTS_DISPLAY_LIMIT;

  return (
    <div className='mb-4'>
      <Command.Group>
        <div className='flex items-center px-2 mb-1'>
          <span className='text-xs font-medium text-muted-foreground uppercase tracking-wide font-["Geist_Mono"]'>
            Recents
          </span>
        </div>

        {visibleRecents.map(entry => {
          const identityKey = identityKeyFor(entry);
          return (
            <Command.Item
              key={identityKey}
              value={`recent-search-${identityKey}`}
              onSelect={() => onSelect(entry)}
              onMouseDown={onItemMouseDown}
              aria-label={recentSearchLabel(entry)}
              className={`group flex items-center gap-3 p-3 rounded-lg cursor-pointer mt-1.5 aria-selected:bg-accent ${!isMobile && 'hover:bg-accent'}`}
              style={{ WebkitTapHighlightColor: 'transparent' }}
              data-track-category='SEARCH'
              data-track-name='RECENT_SEARCH_SELECT'
            >
              <Clock size={16} className='text-muted-foreground flex-shrink-0' />
              {/* Names are pre-resolved by the hook (live by id, snapshot fallback); render as-is. */}
              <span className='flex flex-1 min-w-0 items-center flex-wrap gap-1'>
                <QueryFilterChips mentions={entry.filterChips} currentUserID={currentUserID} />
                {entry.text && (
                  <span className='text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground truncate'>
                    {entry.text}
                  </span>
                )}
              </span>
              {/* The tab this recent replays to — shown only when it isn't All (tab-switch cue). */}
              {entry.tab !== TabType.ALL && (
                <span className='flex-shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground'>
                  {getTabLabel(entry.tab)}
                </span>
              )}
              <button
                type='button'
                aria-label='Remove recent search'
                onClick={event => handleRemove(event, identityKey, onRemove)}
                onMouseDown={event => event.stopPropagation()}
                className='flex-shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground'
                data-track-category='SEARCH'
                data-track-name='RECENT_SEARCH_REMOVE'
              >
                <X size={14} />
              </button>
            </Command.Item>
          );
        })}

        {hasMore && (
          <Command.Item
            value='__see-more-recent-searches__'
            onSelect={() => setIsExpanded(prev => !prev)}
            className={`w-full px-2 py-1.5 mt-1 text-sm text-muted-foreground rounded-lg text-left cursor-pointer transition-colors aria-selected:text-foreground aria-selected:bg-accent ${!isMobile ? 'hover:text-foreground hover:bg-accent' : ''}`}
            style={{ WebkitTapHighlightColor: 'transparent', userSelect: 'none' }}
            data-track-category='SEARCH'
            data-track-name='TOGGLE_RECENT_SEARCHES_EXPANSION'
          >
            {isExpanded ? 'See less' : `See ${hiddenCount} more`}
          </Command.Item>
        )}
      </Command.Group>
    </div>
  );
}

// Stop the row's onSelect (which would replay the search) before removing the row.
const handleRemove = (
  event: React.MouseEvent,
  identityKey: string,
  onRemove: (identityKey: string) => void,
): void => {
  event.preventDefault();
  event.stopPropagation();
  onRemove(identityKey);
};
