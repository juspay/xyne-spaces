import { ReactElement } from 'react';
import { cn } from '@/utils/classNames';
import { CATEGORY_STYLES } from './subsystems';

export const CategoryBadge = ({ category }: { category: string | null }): ReactElement | null => {
  if (!category) return null;
  const style = CATEGORY_STYLES[category.toLowerCase()];
  if (!style) {
    return (
      <span className='rounded border border-border px-1.5 py-px text-xs font-medium uppercase tracking-wide text-muted-foreground'>
        {category}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'rounded border px-1.5 py-px text-xs font-medium uppercase tracking-wide',
        style.className,
      )}
    >
      {style.label}
    </span>
  );
};
