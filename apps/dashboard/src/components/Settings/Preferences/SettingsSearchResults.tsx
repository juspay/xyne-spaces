import type { FC } from 'react';

import { cn } from '../../../utils/classNames';
import type { SettingsSearchEntry, SettingsSearchResult } from './settingsSearch';
import type { NavItem } from '.';

export interface SettingsSearchResultsProps {
  query: string;
  results: SettingsSearchResult[];
  navItems: NavItem[];
  onSelect: (entry: SettingsSearchEntry) => void;
  itemClassName?: string;
}

/** Matching settings shown in place of the section nav while a search is active. */
export const SettingsSearchResults: FC<SettingsSearchResultsProps> = ({
  query,
  results,
  navItems,
  onSelect,
  itemClassName,
}) => {
  if (results.length === 0) {
    return (
      <p className='px-2 py-3 text-sm text-muted-foreground break-words'>
        No settings match “{query.trim()}”
      </p>
    );
  }
  return (
    <div role='listbox' aria-label='Matching settings' className='flex flex-col gap-0.5'>
      {results.map(result => {
        const nav = navItems.find(item => item.id === result.section);
        return (
          <button
            key={`${result.section}:${result.label}`}
            type='button'
            role='option'
            aria-selected={false}
            onClick={() => onSelect(result)}
            className={cn(
              'flex items-start gap-2.5 px-2 py-2 rounded-md text-left w-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
              itemClassName,
            )}
            data-track-category='PREFERENCES'
            data-track-name={`SearchResult_${result.section}`}
          >
            <span className='mt-0.5 shrink-0'>{nav?.icon}</span>
            <span className='min-w-0'>
              <span className='block text-sm text-foreground break-words'>{result.label}</span>
              <span className='block text-xs text-muted-foreground'>{nav?.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
};
