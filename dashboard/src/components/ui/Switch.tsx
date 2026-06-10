import React from 'react';
import { cn } from '../../utils/classNames';

export type SwitchVariant = 'default' | 'desk';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  'aria-label'?: string;
  id?: string;
  disabled?: boolean;
  /** `desk` — pill toggle used in Desk Settings (gray off, brand blue on). */
  variant?: SwitchVariant;
  className?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onCheckedChange,
  label,
  'aria-label': ariaLabel,
  id,
  disabled = false,
  variant = 'default',
  className,
}) => {
  const isDesk = variant === 'desk';

  return (
    <div className={cn('flex items-center', label ? 'gap-3' : '', className)}>
      <button
        id={id}
        type='button'
        role='switch'
        aria-checked={checked}
        aria-label={ariaLabel}
        onClick={() => !disabled && onCheckedChange(!checked)}
        disabled={disabled}
        className={cn(
          'relative inline-flex shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          isDesk ? 'focus-visible:ring-desk-accent/40' : 'focus-visible:ring-blue-600/40',
          disabled && 'opacity-50 cursor-not-allowed',
          isDesk
            ? cn('h-[18px] w-[28px] p-0.5', checked ? 'bg-desk-accent' : 'bg-desk-switch-off')
            : cn('h-5 w-9', checked ? 'bg-blue-600' : 'bg-muted'),
        )}
      >
        <span
          className={cn(
            'inline-block rounded-full transition-transform',
            isDesk
              ? cn(
                  'h-[14px] w-[14px] bg-background shadow-sm',
                  checked ? 'translate-x-[10px]' : 'translate-x-0',
                )
              : cn(
                  'h-3.5 w-3.5 bg-background shadow-sm',
                  checked ? 'translate-x-5' : 'translate-x-0.5',
                ),
          )}
        />
      </button>
      {label && (
        <label htmlFor={id} className='cursor-pointer select-none text-sm text-foreground'>
          {label}
        </label>
      )}
    </div>
  );
};
