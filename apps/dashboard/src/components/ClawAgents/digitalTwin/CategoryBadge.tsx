import { ReactElement } from 'react';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/utils/classNames';
import { CATEGORY_STYLES } from './subsystems';

export const CategoryBadge = ({ category }: { category: string | null }): ReactElement | null => {
  if (!category) return null;
  const style = CATEGORY_STYLES[category.toLowerCase()];
  if (!style) {
    return (
      <Badge variant='outline' className='text-muted-foreground'>
        {category}
      </Badge>
    );
  }
  return (
    <Badge variant='outline' className={cn('border', style.className)}>
      {style.label}
    </Badge>
  );
};
