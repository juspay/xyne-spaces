import { ReactElement, useEffect, useRef } from 'react';
import { cn } from '../../../utils/classNames';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  indeterminate?: boolean;
  disabled?: boolean;
}

export function Checkbox({
  checked,
  onChange,
  label = 'Edit entire series',
  indeterminate = false,
  disabled = false,
}: CheckboxProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      className={cn(
        'group inline-flex items-center gap-2 select-none w-fit',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      {/* Custom checkbox box — both "checked" and "indeterminate" share the
          filled-primary look (Gmail/Outlook convention); the glyph inside
          (check vs dash) is what distinguishes "all" from "some". The
          native input is overlaid (opacity-0) on top of this span so that
          focus stays anchored on the visible glyph — using `sr-only` here
          would absolute-position the input off-flow and trigger a
          focus-scroll jump that scrolls the page to the top on click. */}
      <span
        className={`
          relative flex items-center justify-center
          w-[18px] h-[18px] rounded-[4px] shrink-0
          border transition-all duration-150 ease-in-out
          ${checked || indeterminate ? 'bg-primary border-primary ' : 'bg-card border-border '}
        `}
      >
        <input
          ref={inputRef}
          type='checkbox'
          checked={checked}
          disabled={disabled}
          onChange={e => onChange(e.target.checked)}
          className={cn(
            'absolute inset-0 w-full h-full opacity-0 m-0 p-0',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
        />
        {indeterminate ? (
          <svg
            viewBox='0 0 10 2'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
            className='w-[10px] h-[2px]'
          >
            <path
              d='M1 1H9'
              stroke='hsl(var(--primary-foreground))'
              strokeWidth='1.6'
              strokeLinecap='round'
            />
          </svg>
        ) : (
          <svg
            viewBox='0 0 10 8'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
            className={`w-[10px] h-[8px] transition-all duration-150 ${
              checked ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
            }`}
          >
            <path
              d='M1 4L3.5 6.5L9 1'
              stroke='hsl(var(--primary-foreground))'
              strokeWidth='1.6'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </svg>
        )}
      </span>

      {/* Label text */}
      {label && <span className='text-[13px] font-medium text-foreground'>{label}</span>}
    </label>
  );
}
