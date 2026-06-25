import { ReactElement, useEffect, useRef } from 'react';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  indeterminate?: boolean;
  /** Fill the checked box with the theme accent color (--sidebar-badge-accent) instead of neutral --primary. */
  accent?: boolean;
}

export function Checkbox({
  checked,
  onChange,
  label = 'Edit entire series',
  indeterminate = false,
  accent = false,
}: CheckboxProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const glyphStroke = accent
    ? 'var(--sidebar-badge-accent-foreground)'
    : 'hsl(var(--primary-foreground))';
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className='group inline-flex items-center gap-2 cursor-pointer select-none w-fit'>
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
          ${checked || indeterminate ? (accent ? 'bg-sidebar-badge-accent border-sidebar-badge-accent ' : 'bg-primary border-primary ') : 'bg-card border-border '}
        `}
      >
        <input
          ref={inputRef}
          type='checkbox'
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className='absolute inset-0 w-full h-full opacity-0 cursor-pointer m-0 p-0'
        />
        {indeterminate ? (
          <svg
            viewBox='0 0 10 2'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
            className='w-[10px] h-[2px]'
          >
            <path d='M1 1H9' stroke={glyphStroke} strokeWidth='1.6' strokeLinecap='round' />
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
              stroke={glyphStroke}
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
