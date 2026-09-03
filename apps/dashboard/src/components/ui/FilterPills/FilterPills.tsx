import { ReactElement } from 'react';
import { cn } from '../../../utils/classNames';

export type FilterPillOption<T extends string> = {
  value: T;
  label: string;
  count?: number;
};

type FilterPillsProps<T extends string> = {
  tabs: FilterPillOption<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  ariaLabel: string;
  className?: string;
  testIdPrefix?: string;
};

export const FilterPills = <T extends string>({
  tabs,
  activeTab,
  onTabChange,
  ariaLabel,
  className,
  testIdPrefix,
}: FilterPillsProps<T>): ReactElement => (
  <div
    role='tablist'
    aria-label={ariaLabel}
    className={cn(
      'flex items-center gap-2 overflow-x-auto no-scrollbar min-[700px]:gap-1.5',
      className,
    )}
  >
    {tabs.map(tab => {
      const isActive = tab.value === activeTab;
      const showCount = typeof tab.count === 'number' && tab.count > 0;
      const countLabel = showCount && tab.count! > 99 ? '99+' : tab.count;

      return (
        <button
          key={tab.value}
          type='button'
          role='tab'
          aria-selected={isActive}
          onClick={() => onTabChange(tab.value)}
          data-track-category='FILTER_PILLS'
          data-track-name='CHANGE_FILTER_TAB'
          data-track-metadata={JSON.stringify({ tab: tab.value })}
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-base transition-colors',
            'min-[700px]:px-2.5 min-[700px]:py-1 min-[700px]:text-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            isActive
              ? 'border-border bg-accent font-semibold text-primary'
              : 'border-foreground/15 bg-background font-semibold text-muted-foreground hover:bg-accent',
          )}
          data-testid={testIdPrefix ? `${testIdPrefix}-${tab.value}` : undefined}
        >
          <span>{tab.label}</span>
          {showCount && <span className='tabular-nums'>{countLabel}</span>}
        </button>
      );
    })}
  </div>
);

export default FilterPills;
