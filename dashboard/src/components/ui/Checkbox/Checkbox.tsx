import { ReactElement, useEffect, useRef } from 'react';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  indeterminate?: boolean;
  /** Fill the checked box with the theme accent color (--sidebar-badge-accent) instead of neutral --primary. */
  accent?: boolean;
  /** Non-interactive state. Dims the whole control (label + box) and blocks toggling,
      while keeping the checked glyph/fill visible so the current value still reads clearly. */
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export function Checkbox({
  checked,
  onChange,
  label = 'Edit entire series',
  indeterminate = false,
  accent = false,
  disabled = false,
  size = 'md',
}: CheckboxProps): ReactElement {
  const sm = size === 'sm';
  const inputRef = useRef<HTMLInputElement>(null);
  const glyphStroke = accent
    ? 'var(--sidebar-badge-accent-foreground)'
    : 'hsl(var(--primary-foreground))';
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      className={`group inline-flex items-center gap-2 select-none w-fit ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      }`}
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
          ${sm ? 'w-3 h-3 rounded-[3px]' : 'w-[18px] h-[18px] rounded-[4px]'} shrink-0
          border transition-all duration-150 ease-in-out
          ${checked || indeterminate ? (accent ? 'bg-sidebar-badge-accent border-sidebar-badge-accent ' : 'bg-primary border-primary ') : 'bg-card border-border '}
        `}
      >
        <input
          ref={inputRef}
          type='checkbox'
          checked={checked}
          disabled={disabled}
          onChange={e => onChange(e.target.checked)}
          className={`absolute inset-0 w-full h-full opacity-0 m-0 p-0 ${
            disabled ? 'cursor-not-allowed' : 'cursor-pointer'
          }`}
        />
        {indeterminate ? (
          <svg
            viewBox='0 0 10 2'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
            className={sm ? 'w-[7px] h-[1.5px]' : 'w-[10px] h-[2px]'}
          >
            <path d='M1 1H9' stroke={glyphStroke} strokeWidth='1.6' strokeLinecap='round' />
          </svg>
        ) : (
          <svg
            viewBox='0 0 10 8'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
            className={`${sm ? 'w-[7px] h-[5px]' : 'w-[10px] h-[8px]'} transition-all duration-150 ${
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
      {label && (
        <span
          className={
            sm ? 'text-xs text-muted-foreground' : 'text-[13px] font-medium text-foreground'
          }
        >
          {label}
        </span>
      )}
    </label>
  );
}
