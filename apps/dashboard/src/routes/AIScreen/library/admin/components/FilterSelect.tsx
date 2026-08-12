import type { ReactElement } from 'react';
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
  className = 'w-44',
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}): ReactElement {
  return (
    <Select value={value || 'all'} onValueChange={next => onChange(next === 'all' ? '' : next)}>
      <SelectTrigger
        className={cn('focus-visible:border-ring focus-visible:ring-0', className)}
        aria-label={ariaLabel}
      >
        <SelectValue />
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
