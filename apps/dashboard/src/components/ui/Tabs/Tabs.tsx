import type { ReactElement } from 'react';
import { cn } from '@/utils/classNames';

export interface TabItem {
  id: string;
  label: string;
}

interface TabsProps {
  items: readonly TabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  trackCategory?: string;
  trackPrefix?: string;
  className?: string;
}

export function Tabs({
  items,
  activeId,
  onSelect,
  trackCategory,
  trackPrefix,
  className,
}: TabsProps): ReactElement {
  return (
    <div
      className={cn('no-scrollbar flex items-start gap-1 overflow-x-auto', className)}
      role='tablist'
    >
      {items.map(tab => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type='button'
            role='tab'
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(tab.id)}
            {...(trackCategory ? { 'data-track-category': trackCategory } : {})}
            {...(trackPrefix ? { 'data-track-name': `${trackPrefix}: ${tab.label}` } : {})}
            className={cn(
              'flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-3 py-1 text-sm transition-colors',
              isActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
