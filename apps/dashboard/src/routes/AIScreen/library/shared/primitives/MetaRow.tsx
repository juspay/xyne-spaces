import { Fragment, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/utils/classNames';

export const MetaRow = ({
  badge,
  items,
  className,
}: {
  badge?: ReactNode;
  items: ReactNode[];
  className?: string;
}): ReactElement => {
  const parts = items.filter(Boolean);
  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground',
        className,
      )}
    >
      {badge}
      {parts.map((node, index) => (
        <Fragment key={index}>
          {index > 0 && <span aria-hidden>·</span>}
          {node}
        </Fragment>
      ))}
    </div>
  );
};
