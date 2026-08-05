import { type ReactElement, type ReactNode } from 'react';
import { InformationCircle } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';

export const Separator = ({ className }: { className?: string }): ReactElement => (
  <div className={cn('flex h-4 items-center', className)} aria-hidden>
    <div className='h-px w-full bg-border' />
  </div>
);

interface SectionHeadingProps {
  label: string;
  info?: string;
  action?: ReactNode;
  className?: string;
}

export function SectionHeading({
  label,
  info,
  action,
  className,
}: SectionHeadingProps): ReactElement {
  return (
    <div className={cn('flex h-7 items-center justify-between gap-3', className)}>
      <span className='flex min-w-0 items-center gap-1.5'>
        <span className='truncate text-sm font-semibold leading-5 tracking-[-0.28px] text-foreground'>
          {label}
        </span>
        {info && (
          <Tooltip side='top' content={info}>
            <span className='inline-flex'>
              <InformationCircle className='size-3 shrink-0 text-muted-foreground' aria-hidden />
            </span>
          </Tooltip>
        )}
      </span>
      {action}
    </div>
  );
}
