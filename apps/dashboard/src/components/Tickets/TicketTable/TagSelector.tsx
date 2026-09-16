import React, { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { MultipleCrossCancelDefault as X } from '@xyne/icons';
import { cn } from '../../../utils/classNames';
import { TagsListContent } from '../TagsListContent';

interface TagSelectorProps {
  availableTags: string[];
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  onCreateTag?: ((tagName: string) => void) | undefined;
  stopEditing?: (() => void) | undefined;
  inlineTags?: boolean | undefined;
  allowCreate?: boolean | undefined;
  /** Callback to load more tags */
  onLoadMore?: (() => void) | undefined;
  /** Whether there are more tags to load */
  hasMore?: boolean | undefined;
  /** Callback for server-side search */
  onSearch?: ((query: string) => void) | undefined;
}

export const TagSelector: React.FC<TagSelectorProps> = ({
  availableTags,
  selectedTags,
  onTagsChange,
  onCreateTag,
  stopEditing,
  inlineTags = false,
  allowCreate = true,
  onLoadMore,
  hasMore = false,
  onSearch,
}) => {
  const [isOpen, setIsOpen] = useState(true);

  const toggle = (tag: string) => {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter(t => t !== tag)
      : [...selectedTags, tag];
    onTagsChange(next);
  };

  const handleTagToggled = () => {
    setTimeout(() => stopEditing?.(), 100);
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
          <span className='flex-1 min-w-[60px] text-sm p-1 text-muted-foreground'>
            {selectedTags.length === 0 ? 'Add labels...' : ''}
          </span>
        </label>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side='bottom'
          align='start'
          sideOffset={4}
          className='z-[100] w-80 bg-background border border-border rounded-lg shadow-lg'
          avoidCollisions={true}
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <TagsListContent
            selectedTags={selectedTags}
            onChange={onTagsChange}
            availableTags={availableTags}
            onLoadMore={onLoadMore}
            hasMore={hasMore}
            showSelectAll={false}
            allowCreate={allowCreate}
            onCreateTag={onCreateTag}
            onTagToggled={handleTagToggled}
            onSearch={onSearch}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
