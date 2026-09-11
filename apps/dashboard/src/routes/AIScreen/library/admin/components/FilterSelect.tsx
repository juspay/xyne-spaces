import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/utils/classNames';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';

export function FilterSelect({
  value,
  options,
  onChange,
  ariaLabel,
  icon,
  anchorLabel,
  className = 'w-auto',
}: {
  value: string;
  options: readonly { value: string; label: string; icon?: ReactNode }[];
  onChange: (value: string) => void;
  ariaLabel: string;
  icon?: ReactNode;
  anchorLabel?: string;
  className?: string;
}): ReactElement {
  const current = options.find(option => (option.value || 'all') === (value || 'all'));
  const label = current?.label ?? '';
  const widthAnchor =
    anchorLabel ?? options.find(option => !option.value)?.label ?? options[0]?.label ?? '';

  return (
    <Select value={value || 'all'} onValueChange={next => onChange(next === 'all' ? '' : next)}>
      <SelectTrigger
        className={cn('gap-2 focus-visible:border-ring focus-visible:ring-0', className)}
        aria-label={ariaLabel}
      >
        <SelectValue>
          <span className='flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'>
            {current?.icon ?? icon}
            <span className='relative block'>
              <span className='invisible block whitespace-nowrap' aria-hidden>
                {widthAnchor}
              </span>
              <span className='absolute inset-0 truncate text-left' title={label}>
                {label}
              </span>
            </span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align='end'>
        {options.map(option => (
          <SelectItem key={option.value || 'all'} value={option.value || 'all'}>
            <span className='flex min-w-0 items-center gap-2'>
              {option.icon}
              <span className='block max-w-[15rem] truncate'>{option.label}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
