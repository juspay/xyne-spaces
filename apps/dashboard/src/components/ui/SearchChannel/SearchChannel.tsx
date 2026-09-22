import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Hash, MessageCircle, Search, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import Input from '../Input/Input';
import { Badge } from '../Badge';
import { cn } from '../../../utils/classNames';
import { ChannelScopeType } from '@xyne/shared';

export type SearchChannelCandidate = {
  id: string;
  name: string;
  scopeType: ChannelScopeType;
};

export type SearchChannelItem = {
  id: string;
  name: string;
};

const SEARCH_LIMIT = 10;

export interface SearchChannelProps {
  /** Channels the current user can access (e.g. from visible channels). */
  channels: ReadonlyArray<SearchChannelCandidate>;
  mode: 'channel' | 'dm';
  excludeChannelIds?: string[];
  selectedChannels: SearchChannelItem[];
  onChannelsChange: (channels: SearchChannelItem[]) => void;
  placeholder?: string;
  label?: string;
  hintText?: string;
  width?: string;
  disabled?: { value: boolean; reason?: string };
  autoFocus?: boolean;
  inputTestId?: string;
  trackMetadata?: Record<string, unknown>;
}

function isDmScope(scopeType: ChannelScopeType): boolean {
  return scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM;
}

export const SearchChannel: React.FC<SearchChannelProps> = ({
  channels,
  mode,
  excludeChannelIds = [],
  selectedChannels,
  onChannelsChange,
  placeholder,
  label = '',
  hintText = '',
  width = '100%',
  disabled = { value: false, reason: undefined },
  autoFocus = false,
  inputTestId = 'channel-search-input',
  trackMetadata = {},
}) => {
  const defaultPlaceholder = mode === 'dm' ? 'Search DMs...' : 'Search channels...';

  const [searchValue, setSearchValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const exclude = useMemo(() => new Set(excludeChannelIds), [excludeChannelIds]);
  const selectedIds = useMemo(() => new Set(selectedChannels.map(c => c.id)), [selectedChannels]);

  const filteredChannels = useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    if (!q) return [];

    const rows: SearchChannelCandidate[] = [];
    for (const ch of channels) {
      const dm = isDmScope(ch.scopeType);
      if (mode === 'channel' && dm) continue;
      if (mode === 'dm' && !dm) continue;
      if (exclude.has(ch.id) || selectedIds.has(ch.id)) continue;
      const labelName = mode === 'dm' ? ch.name || 'Direct message' : ch.name || ch.id;
      if (!labelName.toLowerCase().includes(q)) continue;
      rows.push({ ...ch, name: labelName });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows.slice(0, SEARCH_LIMIT);
  }, [channels, mode, searchValue, exclude, selectedIds]);

  const ListIcon = mode === 'dm' ? MessageCircle : Hash;

  useEffect(() => {
    const shouldShow = searchValue.trim().length > 0 && !disabled.value;
    setIsOpen(shouldShow);
    if (!shouldShow) setSelectedIndex(-1);
  }, [searchValue, disabled.value]);

  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const el = listRef.current.children[selectedIndex] as HTMLElement;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setSearchValue(e.target.value);
    setIsOpen(true);
    setSelectedIndex(-1);
  };

  const handleSelect = (ch: SearchChannelCandidate): void => {
    if (selectedIds.has(ch.id)) return;
    const displayName = mode === 'dm' ? ch.name || 'Direct message' : ch.name || ch.id;
    onChannelsChange([...selectedChannels, { id: ch.id, name: displayName }]);
    setSearchValue('');
    setIsOpen(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const handleTagRemove = (c: SearchChannelItem): void => {
    onChannelsChange(selectedChannels.filter(x => x.id !== c.id));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (disabled.value) return;

    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setIsOpen(true);
      return;
    }
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev < filteredChannels.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && filteredChannels[selectedIndex]) {
          handleSelect(filteredChannels[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSelectedIndex(-1);
        inputRef.current?.blur();
        break;
    }
  };

  const handleFocus = (): void => {
    if (!disabled.value && searchValue.trim().length > 0) setIsOpen(true);
  };

  const trackName = mode === 'dm' ? 'SHARE_MODAL_SELECT_DM' : 'SHARE_MODAL_SELECT_CHANNEL';

  return (
    <div style={{ width }} className='w-full'>
      {label ? (
        <label className='block text-sm font-medium text-foreground mb-1.5'>{label}</label>
      ) : null}

      {selectedChannels.length > 0 ? (
        <div className='flex flex-wrap gap-2 mb-2'>
          {selectedChannels.map(c => (
            <Badge key={c.id} variant='primary' className='flex items-center gap-1.5 pr-1'>
              <span className='text-xs truncate max-w-[200px]'>{c.name}</span>
              {!disabled.value ? (
                <button
                  type='button'
                  onClick={() => handleTagRemove(c)}
                  data-track-category='ENTITY_PICKER'
                  data-track-name='REMOVE_CHANNEL_CHIP'
                  className='rounded-full p-0.5 transition-colors'
                  aria-label={`Remove ${c.name}`}
                >
                  <X className='h-3 w-3' />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      ) : null}

      <Popover.Root open={isOpen && !disabled.value} onOpenChange={setIsOpen}>
        <Popover.Anchor asChild>
          <div className='relative'>
            <Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none z-10' />
            <Input
              ref={inputRef}
              type='text'
              role='combobox'
              aria-expanded={isOpen}
              aria-controls='search-channel-listbox'
              className={cn('pl-10', disabled.value && 'cursor-not-allowed opacity-50')}
              placeholder={placeholder ?? defaultPlaceholder}
              data-testid={inputTestId}
              value={searchValue}
              onChange={handleSearchChange}
              onKeyDown={handleKeyDown}
              onFocus={handleFocus}
              disabled={disabled.value}
              autoFocus={autoFocus}
            />
          </div>
        </Popover.Anchor>

        <Popover.Portal>
          <Popover.Content
            data-testid={mode === 'dm' ? 'dm-channel-search-results' : 'channel-search-results'}
            side='bottom'
            align='start'
            sideOffset={4}
            className={cn(
              'z-[9999] min-w-[var(--radix-popover-trigger-width)] max-h-[250px] overflow-y-auto',
              'rounded-md border border-border bg-popover shadow-lg',
            )}
            onOpenAutoFocus={e => e.preventDefault()}
            collisionPadding={8}
            onInteractOutside={() => {
              setIsOpen(false);
              setSelectedIndex(-1);
            }}
          >
            {filteredChannels.length > 0 ? (
              <ul ref={listRef} id='search-channel-listbox' role='listbox' className='py-1'>
                {filteredChannels.map((ch, index) => (
                  <li
                    key={ch.id}
                    id={`search-channel-option-${index}`}
                    role='option'
                    aria-selected={index === selectedIndex}
                    className={cn(
                      'relative flex cursor-pointer select-none items-center gap-3 px-3 py-2 text-sm outline-none transition-colors',
                      index === selectedIndex
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent hover:text-accent-foreground',
                    )}
                    onClick={() => handleSelect(ch)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelect(ch);
                      }
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                    tabIndex={-1}
                    data-track-category='CANVAS'
                    data-track-name={trackName}
                    data-track-metadata={JSON.stringify({
                      ...trackMetadata,
                      channelId: ch.id,
                    })}
                  >
                    <ListIcon className='size-4 shrink-0 text-muted-foreground' />
                    <span className='font-medium truncate'>{ch.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className='px-4 py-4 text-center text-sm text-muted-foreground'>
                {searchValue.trim()
                  ? mode === 'dm'
                    ? `No DMs found matching "${searchValue}"`
                    : `No channels found matching "${searchValue}"`
                  : 'Start typing to search...'}
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {hintText && !disabled.value ? (
        <p className='text-xs text-muted-foreground mt-1.5'>{hintText}</p>
      ) : null}
      {disabled.reason ? <p className='text-red-600 text-sm mt-1'>{disabled.reason}</p> : null}
    </div>
  );
};
