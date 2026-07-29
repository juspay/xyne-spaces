import React from 'react';
import { LayoutGrid, List } from 'lucide-react';

export type ViewMode = 'grid' | 'list';

interface ViewToggleV2Props {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export const ViewToggleV2: React.FC<ViewToggleV2Props> = ({ value, onChange }) => {
  return (
    <div
      role='group'
      aria-label='View mode'
      className='inline-flex items-center rounded-full border border-border bg-secondary p-0.5'
    >
      <button
        type='button'
        aria-label='Grid view'
        aria-pressed={value === 'grid'}
        onClick={() => {
          onChange('grid');
        }}
        className={
          value === 'grid'
            ? 'inline-flex h-7 w-7 items-center justify-center rounded-full bg-background text-foreground shadow-sm'
            : 'inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground'
        }
        data-track-category='knowledge-base'
        data-track-name='view-mode-grid'
      >
        <LayoutGrid className='h-3.5 w-3.5' aria-hidden strokeWidth={1.75} />
      </button>
      <button
        type='button'
        aria-label='List view'
        aria-pressed={value === 'list'}
        onClick={() => {
          onChange('list');
        }}
        className={
          value === 'list'
            ? 'inline-flex h-7 w-7 items-center justify-center rounded-full bg-background text-foreground shadow-sm'
            : 'inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground'
        }
        data-track-category='knowledge-base'
        data-track-name='view-mode-list'
      >
        <List className='h-3.5 w-3.5' aria-hidden strokeWidth={1.75} />
      </button>
    </div>
  );
};
