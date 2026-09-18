import { useRef, type KeyboardEvent, type ReactElement } from 'react';
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
  idPrefix?: string;
}

export function Tabs({
  items,
  activeId,
  onSelect,
  trackCategory,
  trackPrefix,
  className,
  idPrefix,
}: TabsProps): ReactElement {
  const listRef = useRef<HTMLDivElement | null>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const jump = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
    if (delta === 0 && jump < 0) return;
    event.preventDefault();
    const current = items.findIndex(item => item.id === activeId);
    const next = jump >= 0 ? jump : (current + delta + items.length) % items.length;
    const target = items[next];
    if (!target) return;
    onSelect(target.id);
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[next]?.focus();
  };

  return (
    <div
      ref={listRef}
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
            id={idPrefix ? `${idPrefix}-tab-${tab.id}` : undefined}
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${tab.id}` : undefined}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={onKeyDown}
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
