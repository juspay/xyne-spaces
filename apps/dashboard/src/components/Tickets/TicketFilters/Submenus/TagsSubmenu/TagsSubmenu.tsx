import { ReactElement } from 'react';
import { TagsListContent } from '../../../TagsListContent';

interface TagsSubmenuProps {
  selectedTags: string[];
  onChange: (tags: string[]) => void;
  availableTags?: string[] | undefined;
  className?: string | undefined;
  /** Callback to load more tags */
  onLoadMore?: (() => void) | undefined;
  /** Whether there are more tags to load */
  hasMore?: boolean | undefined;
  /** Callback for server-side search */
  onSearch?: ((query: string) => void) | undefined;
}

export const TagsSubmenu = ({
  selectedTags,
  onChange,
  availableTags = [],
  className = '',
  onLoadMore,
  hasMore = false,
  onSearch,
}: TagsSubmenuProps): ReactElement => {
  return (
    <div
      className={`w-80 border border-border flex flex-col rounded-lg shadow-lg bg-background overflow-hidden ${className}`}
    >
      <TagsListContent
        selectedTags={selectedTags}
        onChange={onChange}
        availableTags={availableTags}
        onLoadMore={onLoadMore}
        hasMore={hasMore}
        showSelectAll={true}
        onSearch={onSearch}
      />
      {selectedTags.length > 0 && (
        <div className='p-3 border-t bg-muted'>
          <div className='text-xs text-muted-foreground'>
            {selectedTags.length} label{selectedTags.length !== 1 ? 's' : ''} selected
          </div>
        </div>
      )}
    </div>
  );
};
