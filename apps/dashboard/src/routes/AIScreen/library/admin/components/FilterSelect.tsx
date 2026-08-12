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
  className = 'w-auto min-w-[9rem] max-w-[16rem]',
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
  icon?: ReactNode;
  className?: string;
}): ReactElement {
  const current = options.find(option => (option.value || 'all') === (value || 'all'));

  return (
    <Select value={value || 'all'} onValueChange={next => onChange(next === 'all' ? '' : next)}>
      <SelectTrigger
        className={cn('gap-2 focus-visible:border-ring focus-visible:ring-0', className)}
        aria-label={ariaLabel}
      >
        <SelectValue>
          <span className='flex min-w-0 items-center gap-2'>
            {icon}
            <span className='truncate'>{current?.label ?? ''}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option.value || 'all'} value={option.value || 'all'}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
