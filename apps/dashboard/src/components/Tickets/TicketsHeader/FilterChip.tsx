import { ReactElement, ReactNode } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { MultipleCrossCancelDefault as Cross } from '@xyne/icons';
import { cn } from '../../../utils/classNames';

interface FilterChipProps {
  label: string;
  icon: ReactNode;
  operator: string;
  value: string;
  mono?: boolean | undefined;
  removable?: boolean;
  onRemove?: (() => void) | undefined;
  open?: boolean;
  onOpenChange?: ((open: boolean) => void) | undefined;
  picker?: ReactNode;
  removeTitle?: string;
  testId?: string;
}

const chipSurface =
  'inline-flex h-[26px] shrink-0 items-center rounded-[9px] border border-border bg-background';

export const FilterChip = ({
  label,
  icon,
  operator,
  value,
  mono,
  removable = true,
  onRemove,
  open,
  onOpenChange,
  picker,
  removeTitle = 'Remove filter',
  testId,
}: FilterChipProps): ReactElement => {
  const valueSegment = (
    <span
      className={cn(
        'inline-flex h-6 max-w-[180px] items-center gap-[5px] truncate px-2 text-[12px] font-medium text-foreground',
        !!picker && 'cursor-pointer hover:bg-muted',
        !removable && 'rounded-r-[8px]',
        mono && 'font-mono',
      )}
    >
      {value}
    </span>
  );
  return (
    <div className={chipSurface} {...(testId ? { 'data-testid': testId } : {})}>
      <span className='inline-flex h-6 items-center gap-1.5 whitespace-nowrap pl-[9px] pr-[5px] text-[12px] font-medium text-foreground/80 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground/80'>
        {icon}
        {label}
      </span>
      <span
        className='inline-flex h-6 items-center whitespace-nowrap border-x border-border px-[7px] text-[12px] font-medium text-muted-foreground'
        title={`${label} has one operator`}
      >
        {operator}
      </span>
      {picker ? (
        <PopoverPrimitive.Root
          {...(open !== undefined ? { open } : {})}
          {...(onOpenChange ? { onOpenChange } : {})}
        >
          <PopoverPrimitive.Trigger asChild>
            <button
              type='button'
              className='inline-flex outline-none'
              data-testid='filter-chip-value'
              data-track-category='Tickets'
              data-track-name='OpenFilterChipValue'
            >
              {valueSegment}
            </button>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              side='bottom'
              align='start'
              sideOffset={6}
              className='z-[60] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1'
            >
              {picker}
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      ) : (
        valueSegment
      )}
      {removable && (
        <button
          type='button'
          title={removeTitle}
          aria-label={removeTitle}
          onClick={onRemove}
          data-track-category='Tickets'
          data-track-name='RemoveFilterChip'
          className='flex size-6 items-center justify-center rounded-r-[8px] text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground'
        >
          <Cross className='size-[13px]' />
        </button>
      )}
    </div>
  );
};
