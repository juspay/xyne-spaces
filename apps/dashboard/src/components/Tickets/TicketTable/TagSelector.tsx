import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, X, Plus } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { Button } from '../../ui/Button/Button';

interface TagSelectorProps {
  availableTags: string[];
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  onCreateTag?: (tagName: string) => void;
  stopEditing?: () => void;
  inlineTags?: boolean;
}

export const TagSelector: React.FC<TagSelectorProps> = ({
  availableTags,
  selectedTags,
  onTagsChange,
  onCreateTag,
  stopEditing,
  inlineTags = false,
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => setActiveIdx(0), [search]);

  const filtered = useMemo(() => {
    const lower = search.toLowerCase().trim();
    return lower ? availableTags.filter(t => t.toLowerCase().includes(lower)) : availableTags;
  }, [availableTags, search]);

  const canCreate = useMemo(() => {
    const trimmed = search.trim();
    return trimmed && !availableTags.some(t => t.toLowerCase() === trimmed.toLowerCase());
  }, [search, availableTags]);

  const toggle = (tag: string) => {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter(t => t !== tag)
      : [...selectedTags, tag];
    onTagsChange(next);
    setTimeout(() => stopEditing?.(), 100);
  };

  const create = () => {
    const trimmed = search.trim();
    if (canCreate) {
      if (onCreateTag) {
        onCreateTag(trimmed);
      }
      onTagsChange([...selectedTags, trimmed]);
      setSearch('');
      setTimeout(() => stopEditing?.(), 100);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const maxIdx = canCreate ? filtered.length : filtered.length - 1;
      setActiveIdx(prev => Math.min(prev + 1, maxIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Backspace' && !search && selectedTags.length) {
      onTagsChange(selectedTags.slice(0, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();

      if (filtered[activeIdx]) {
        toggle(filtered[activeIdx]);
        setSearch('');
      } else if (canCreate && activeIdx === filtered.length) {
        create();
      } else if (canCreate && filtered.length === 0) {
        create();
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      stopEditing?.();
    }
  };

  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={open => {
        setIsOpen(open);
        if (!open) stopEditing?.();
      }}
    >
      <Popover.Trigger asChild>
        <label
          className={cn(
            'gap-1 p-1 min-h-[32px] w-full bg-background cursor-text rounded-md flex',
            !inlineTags && 'flex-wrap',
            inlineTags && 'overflow-hidden',
          )}
        >
          {' '}
          {selectedTags.map(tag => (
            <span
              key={tag}
              role='listitem'
              className='flex items-center justify-between w-max gap-1.5 px-2 py-1 rounded-md text-sm font-medium border bg-card text-muted-foreground border-border'
            >
              <span className='size-2 rounded-full bg-xyne-purple-400' />
              {tag}
              <button
                type='button'
                aria-label={`Remove ${tag}`}
                onClick={e => {
                  e.stopPropagation();
                  toggle(tag);
                }}
                className='hover:bg-border rounded-full p-0.5'
                data-track-category='Tickets'
                data-track-name='RemoveTag'
                data-track-metadata={JSON.stringify({ tag })}
              >
                <X className='size-2.5' />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            className='flex-1 min-w-[60px] bg-transparent border-none text-sm p-1 outline-none'
            placeholder={selectedTags.length === 0 ? 'Add labels...' : ''}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleKey}
            data-track-event='blur'
            data-track-category='Tickets'
            data-track-name='TagSearchInput'
          />
        </label>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side='bottom'
          align='start'
          sideOffset={4}
          className='z-[100] w-[var(--radix-popover-trigger-width)] bg-background border border-border rounded-lg shadow-lg mr-auto'
          avoidCollisions={true}
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <div className='max-h-[240px] overflow-y-auto p-1'>
            {filtered.length > 0 ? (
              filtered.map((tag, i) => {
                const selected = selectedTags.includes(tag);
                const active = i === activeIdx;
                return (
                  <Button
                    key={tag}
                    variant='ghost'
                    trackId='ticket_toggle_tag'
                    onClick={() => {
                      toggle(tag);
                      setSearch('');
                    }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`flex items-center justify-between w-full px-3 py-2 text-sm rounded text-left ${
                      active ? 'bg-muted' : ''
                    } ${selected ? 'text-blue-700 font-medium' : 'text-foreground'}`}
                    data-track-category='Tickets'
                    data-track-name='SelectTag'
                    data-track-metadata={JSON.stringify({ tag, selected: !selected })}
                  >
                    <div className='flex items-center gap-2'>
                      <span className='w-2 h-2 rounded-full bg-xyne-purple-400' />
                      {tag}
                    </div>
                    {selected && <Check className='size-4 text-blue-600' />}
                  </Button>
                );
              })
            ) : search.trim() ? (
              <div className='p-3 text-center text-sm text-muted-foreground'>
                No matching labels
              </div>
            ) : (
              <div className='p-3 text-center text-sm text-muted-foreground'>
                No labels available
              </div>
            )}

            {canCreate && (
              <div className='border-t border-border mt-1 pt-1'>
                <Button
                  variant='ghost'
                  trackId='ticket_create_tag'
                  onClick={create}
                  onMouseEnter={() => setActiveIdx(filtered.length)}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-sm rounded font-medium ${
                    activeIdx === filtered.length ? 'bg-blue-50 text-blue-700' : 'text-blue-600'
                  }`}
                  data-track-category='Tickets'
                  data-track-name='CreateTag'
                  data-track-metadata={JSON.stringify({ tagName: search.trim() })}
                >
                  <Plus className='size-4' />
                  Create {search.trim()}
                </Button>
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
