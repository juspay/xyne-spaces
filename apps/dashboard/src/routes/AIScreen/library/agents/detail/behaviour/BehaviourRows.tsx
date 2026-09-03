import { type ReactElement, type ReactNode } from 'react';
import { PencilEditLine } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select/index';
import { DetailValue } from '../../../shared/primitives/DetailPrimitives';

export function BehaviourRow({
  title,
  hint,
  children,
  last = false,
}: {
  title: string;
  hint: string;
  children: ReactNode;
  last?: boolean;
}): ReactElement {
  return (
    <div
      className={cn(
        'flex w-full items-start justify-between gap-6 px-4 py-3',
        !last && 'border-b border-border',
      )}
    >
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='text-sm font-medium leading-5 text-foreground'>{title}</span>
        <span className='text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
          {hint}
        </span>
      </div>
      <div className='flex shrink-0 items-center gap-2 pt-0.5'>{children}</div>
    </div>
  );
}

/** Switch styled to the v2 language. Falls back to text when not editable. */
export function BehaviourToggle({
  checked,
  editable,
  disabled = false,
  label,
  trackName,
  onChange,
}: {
  checked: boolean;
  editable: boolean;
  disabled?: boolean;
  label: string;
  trackName: string;
  onChange: (next: boolean) => void;
}): ReactElement {
  if (!editable) return <DetailValue>{checked ? 'On' : 'Off'}</DetailValue>;

  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      data-track-category='Claw Agents'
      data-track-name={trackName}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        checked ? 'bg-foreground' : 'bg-border',
      )}
    >
      <span
        className={cn(
          'inline-block size-4 rounded-full bg-background shadow-sm transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export function BehaviourSelect({
  value,
  options,
  editable,
  disabled = false,
  label,
  trackName,
  triggerClassName,
  onChange,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string; icon?: ReactNode }>;
  editable: boolean;
  disabled?: boolean;
  label: string;
  trackName: string;
  triggerClassName?: string;
  onChange: (next: string) => void;
}): ReactElement {
  const current = options.find(option => option.value === value);
  if (!editable) return <DetailValue>{current?.label ?? '—'}</DetailValue>;

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        size='sm'
        aria-label={label}
        data-track-category='Claw Agents'
        data-track-name={trackName}
        className={cn('h-9 w-auto min-w-0 max-w-[240px] gap-2 rounded-[10px]', triggerClassName)}
      >
        <SelectValue>
          <span className='flex min-w-0 items-center gap-2'>
            {current?.icon}
            <span className='truncate'>{current?.label ?? '—'}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align='end'>
        {options.map(option => (
          <SelectItem key={option.value} value={option.value}>
            <span className='flex items-center gap-2'>
              {option.icon}
              <span>{option.label}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Opens the dialog that carries a setting's detail fields. */
export function BehaviourEditButton({
  label,
  trackName,
  disabled = false,
  onClick,
}: {
  label: string;
  trackName: string;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-track-category='Claw Agents'
      data-track-name={trackName}
      className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40'
    >
      <PencilEditLine className='size-4' aria-hidden />
    </button>
  );
}
