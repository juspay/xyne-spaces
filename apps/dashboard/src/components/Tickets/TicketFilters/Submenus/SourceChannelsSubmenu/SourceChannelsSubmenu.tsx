import { ReactElement, useState, useEffect, useMemo, useRef } from 'react';
import { SearchDefault as Search, CheckTickSingle as Check, Hashtag as Hash } from '@xyne/icons';
import Input from '../../../../ui/Input/Input';
import { usePlatform } from '../../../../../hooks/usePlatform';
import { useBrowsableChannels } from '../../../../../hooks/useChannels';

interface SourceChannelsSubmenuProps {
  projectIds: string[];
  selectedChannels: string[];
  onChange: (channelIds: string[]) => void;
  className?: string;
}

// Source-channel submenu for every filter context: fixed-project views pass a
// single-element projectIds array, the derived views (My Tickets / Create-new-view)
// pass the projects behind their boards.
export const SourceChannelsSubmenu = ({
  projectIds,
  selectedChannels,
  onChange,
  className = '',
}: SourceChannelsSubmenuProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = usePlatform();

  const browsableChannels = useBrowsableChannels();

  const channels = useMemo(() => {
    const projectIdSet = new Set(projectIds);
    return browsableChannels
      .filter(channel => projectIdSet.has(channel.projectId))
      .map(channel => ({ id: channel.id, name: channel.name }));
  }, [browsableChannels, projectIds]);

  useEffect(() => {
    if (isMobile) return;
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return (): void => cancelAnimationFrame(rafId);
  }, [isMobile]);

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchQuery), 300);
    return (): void => clearTimeout(timer);
  }, [searchQuery]);

  const finalResults = useMemo(() => {
    if (channels.length === 0) return [];

    let list = [...channels];

    if (searchTerm.trim()) {
      const lower = searchTerm.toLowerCase();
      list = list.filter(channel => channel.name.toLowerCase().includes(lower));
    }

    const selectedSet = new Set(selectedChannels);
    return list
      .sort((a, b) => {
        const aSel = selectedSet.has(a.id) ? 1 : 0;
        const bSel = selectedSet.has(b.id) ? 1 : 0;
        return bSel - aSel;
      })
      .slice(0, 50);
  }, [channels, searchTerm, selectedChannels]);

  const handleChannelToggle = (channelId: string): void => {
    const isSelected = selectedChannels.includes(channelId);
    onChange(
      isSelected
        ? selectedChannels.filter(id => id !== channelId)
        : [...selectedChannels, channelId],
    );
  };

  const visibleChannelIds = finalResults.map(c => c.id);
  const allVisibleSelected =
    visibleChannelIds.length > 0 && visibleChannelIds.every(id => selectedChannels.includes(id));

  const handleSelectAllToggle = (): void => {
    if (allVisibleSelected) {
      onChange(selectedChannels.filter(id => !visibleChannelIds.includes(id)));
    } else {
      const merged = new Set([...selectedChannels, ...visibleChannelIds]);
      onChange([...merged]);
    }
  };

  return (
    <div
      className={`w-80 border border-border flex flex-col rounded-lg shadow-lg bg-background overflow-hidden ${className}`}
    >
      <div className='p-3 border-b sticky top-0 bg-background z-10'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            ref={searchInputRef}
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Search channels...'
            className='pl-9 h-9'
          />
        </div>
      </div>
      <div className='max-h-80 overflow-y-auto p-1' role='listbox' aria-multiselectable='true'>
        {channels.length === 0 ? (
          <div className='p-8 text-center text-sm text-muted-foreground'>No channels available</div>
        ) : finalResults.length > 0 ? (
          <div className='space-y-0.5'>
            <button
              type='button'
              onClick={handleSelectAllToggle}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none
                ${allVisibleSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
                focus-visible:ring-2 focus-visible:ring-ring border-b border-border/50
              `}
              data-track-category='Tickets'
              data-track-name='ToggleSelectAllSourceChannels'
            >
              <span className='flex-1 text-left text-sm font-medium text-primary'>
                {allVisibleSelected ? 'Deselect all' : 'Select all'}
              </span>
              {allVisibleSelected && (
                <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />
              )}
            </button>
            {finalResults.map(channel => {
              const isSelected = selectedChannels.includes(channel.id);
              return (
                <button
                  key={channel.id}
                  type='button'
                  onClick={() => handleChannelToggle(channel.id)}
                  className={`
                    w-full flex items-center gap-2 px-3 py-2 rounded-md transition-all outline-none
                    ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
                    focus-visible:ring-2 focus-visible:ring-ring
                  `}
                  data-track-category='Tickets'
                  data-track-name='ToggleSourceChannelFilter'
                  data-track-metadata={JSON.stringify({
                    channelId: channel.id,
                    channelName: channel.name,
                    selected: !isSelected,
                  })}
                >
                  <Hash className='w-4 h-4 text-muted-foreground shrink-0' aria-hidden='true' />
                  <span className='flex-1 text-left text-sm truncate'>{channel.name}</span>
                  {isSelected && (
                    <Check className='w-4 h-4 text-primary shrink-0' aria-hidden='true' />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className='p-8 text-center text-sm text-muted-foreground'>No channels found</div>
        )}
      </div>
      {selectedChannels.length > 0 && (
        <div className='p-3 border-t bg-muted'>
          <div className='text-xs text-muted-foreground'>
            {selectedChannels.length} channel{selectedChannels.length !== 1 ? 's' : ''} selected
          </div>
        </div>
      )}
    </div>
  );
};
