import { ComponentPropsWithoutRef, ReactElement, useEffect, useRef } from 'react';

interface CheckboxProps extends Omit<ComponentPropsWithoutRef<'input'>, 'onChange' | 'size'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  ariaLabel?: string;
  indeterminate?: boolean;
  /** Non-interactive state. Dims the whole control (label + box) and blocks toggling,
      while keeping the checked glyph/fill visible so the current value still reads clearly. */
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Constrain the label to a single line and ellipsize it, letting the control
      shrink below its content width. For tight flex rows (e.g. composer footers)
      where a long label would otherwise push siblings out of the container. */
  truncateLabel?: boolean;
  /** Replaces the size preset's label typography. For surfaces where the label has to
      match surrounding text rather than the checkbox's own scale (e.g. the search
      Filters dialog, where labels sit at the same 14px as the field values). */
  labelClassName?: string;
}

export function Checkbox({
  checked,
  onChange,
  label = 'Edit entire series',
  ariaLabel,
  indeterminate = false,
  disabled = false,
  size = 'md',
  truncateLabel = false,
  labelClassName,
  ...rest
}: CheckboxProps): ReactElement {
  const sm = size === 'sm';
  const inputRef = useRef<HTMLInputElement>(null);
  const glyphStroke = 'hsl(var(--primary-foreground))';
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      className={`group inline-flex items-center gap-2 select-none ${
        truncateLabel ? 'min-w-0 max-w-full' : 'w-fit'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
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
          ${checked || indeterminate ? 'bg-primary border-primary ' : 'bg-card border-border '}
        `}
      >
        <input
          ref={inputRef}
          type='checkbox'
          checked={checked}
          disabled={disabled}
          {
            /* eslint-disable-next-line @typescript-eslint/naming-convention */
            ...(ariaLabel ? { 'aria-label': ariaLabel } : {})
          }
          onChange={e => onChange(e.target.checked)}
          // Default tag so every Checkbox is captured even when the call site
          // adds nothing. `rest` is spread after it, so a call site passing
          // data-track-category/name overrides these — same as any other
          // element. globalClickTracker ignores clicks on inputs, so this is
          // picked up by its change listener as a SELECTION_CHANGE.
          data-track-category='CHECKBOX'
          data-track-name={label ?? 'CHECKBOX'}
          className={`absolute inset-0 w-full h-full opacity-0 m-0 p-0 ${
            disabled ? 'cursor-not-allowed' : 'cursor-pointer'
          }`}
          {...rest}
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
          className={`${
            labelClassName ??
            (sm ? 'text-xs text-muted-foreground' : 'text-[13px] font-medium text-foreground')
          } ${truncateLabel ? 'truncate' : ''}`}
          {...(truncateLabel && { title: label })}
        >
          {label}
        </span>
      )}
    </label>
  );
}
