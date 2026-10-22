import { useEffect, useRef, type FC } from 'react';

import { cn } from '../../../utils/classNames';
import type { SettingsSearchEntry, SettingsSearchResult } from './settingsSearch';
import type { NavItem, PreferenceSection } from '.';

export const SETTINGS_SEARCH_RESULTS_ID = 'settings-search-results';

export const settingsSearchOptionId = (index: number): string => `settings-search-option-${index}`;

export interface SettingsSearchResultsProps {
  query: string;
  results: SettingsSearchResult[];
  navItems: NavItem[];
  activeIndex: number;
  onSelect: (entry: SettingsSearchEntry) => void;
  onHover: (index: number) => void;
  itemClassName?: string;
}

/** Matching settings shown in place of the section nav while a search is active. */
export const SettingsSearchResults: FC<SettingsSearchResultsProps> = ({
  query,
  results,
  navItems,
  activeIndex,
  onSelect,
  onHover,
  itemClassName,
}) => {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, results]);

  if (results.length === 0) {
    return (
      <p className='px-2 py-3 text-sm text-muted-foreground break-words'>
        No settings match “{query.trim()}”
      </p>
    );
  }

  const groups: Array<{
    section: PreferenceSection;
    items: Array<{ result: SettingsSearchResult; index: number }>;
  }> = [];
  results.forEach((result, index) => {
    const last = groups[groups.length - 1];
    if (last?.section === result.section) last.items.push({ result, index });
    else groups.push({ section: result.section, items: [{ result, index }] });
  });

  return (
    <div
      id={SETTINGS_SEARCH_RESULTS_ID}
      role='listbox'
      aria-label='Matching settings'
      data-theme-tokens=''
      className='flex flex-col gap-2'
    >
      {groups.map(group => {
        const nav = navItems.find(item => item.id === group.section);
        const headingId = `settings-search-group-${group.section}`;
        return (
          <div
            key={group.section}
            role='group'
            aria-labelledby={headingId}
            className='flex flex-col gap-0.5'
          >
            <div
              id={headingId}
              className='flex items-center gap-1.5 px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground [&_svg]:size-3'
            >
              {nav?.icon}
              {nav?.label}
            </div>
            {group.items.map(({ result, index }) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={`${result.section}:${result.label}`}
                  ref={isActive ? activeRef : undefined}
                  id={settingsSearchOptionId(index)}
                  type='button'
                  role='option'
                  tabIndex={-1}
                  aria-selected={isActive}
                  data-theme-tokens=''
                  title={result.label}
                  onClick={() => onSelect(result)}
                  onMouseMove={() => onHover(index)}
                  className={cn(
                    'block w-full truncate px-2 py-1.5 rounded-md text-left text-sm text-foreground',
                    isActive && 'bg-muted',
                    itemClassName,
                  )}
                  data-track-category='PREFERENCES'
                  data-track-name={`SearchResult_${result.section}`}
                >
                  {result.labelParts.map((part, i) =>
                    part.match ? (
                      <mark key={i} className='rounded-[3px] bg-primary/20 text-inherit'>
                        {part.text}
                      </mark>
                    ) : (
                      <span key={i}>{part.text}</span>
                    ),
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
