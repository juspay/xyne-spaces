import { forwardRef, useState } from 'react';
import { TextInputProps } from './index';
import { cn } from '../../../utils/classNames';
import { cva } from 'class-variance-authority';
import Input from '../Input';
import { useInputIds } from './userInputIds';

const textInputWrapper = cva(
  'group/input-group relative flex w-full items-center rounded-lg transition-[color,box-shadow] outline-none border',
  {
    variants: {
      size: {
        sm: 'h-8 text-sm',
        md: 'h-10 text-base',
        lg: 'h-12 text-lg',
      },
      state: {
        default: ' hover:border-input',
        error: 'border-destructive ',
        focus: 'border-indigo-500',
        disabled: 'border-input opacity-50 cursor-not-allowed bg-muted',
      },
    },
    defaultVariants: {
      size: 'md',
      state: 'default',
    },
  },
);

const inputGroupAddonVariants = cva(
  "text-muted-foreground flex h-autos items-center justify-center gap-2 py-1.5 text-sm font-medium select-none [&>svg:not([class*='size-'])]:size-4 [&>kbd]:rounded-[calc(var(--radius)-5px)] group-data-[disabled=true]/input-group:opacity-50",
  {
    variants: {
      align: {
        'inline-start': 'order-first pl-3 has-[>button]:ml-[-0.45rem] has-[>kbd]:ml-[-0.35rem]',
        'inline-end': 'order-last pr-3 has-[>button]:mr-[-0.45rem] has-[>kbd]:mr-[-0.35rem]',
        'block-start':
          'order-first w-full justify-start px-3 pt-3 [.border-b]:pb-3 group-has-[>input]/input-group:pt-2.5',
        'block-end':
          'order-last w-full justify-start px-3 pb-3 [.border-t]:pt-3 group-has-[>input]/input-group:pb-2.5',
      },
    },
    defaultVariants: {
      align: 'inline-start',
    },
  },
);

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>((props, ref) => {
  const [isFocused, setIsFocused] = useState(false);

  const {
    label,
    sublabel,
    hintText,
    error,
    size = 'md',
    leftSlot,
    rightSlot,
    value,
    onChange,
    onBlur,
    onFocus,
    cursor,
    className,
    disabled,
    ...rest
  } = props;

  const hasError = Boolean(error);
  const errorMessage = typeof error === 'string' ? error : 'invalid input';

  const { inputId, labelId, hintId, errorId } = useInputIds(props.id);

  const describedBy =
    [hintText ? hintId : null, hasError ? errorId : null].filter(Boolean).join(' ') || undefined;

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    onFocus?.(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    onBlur?.(e);
  };

  const getState = () => {
    if (disabled) return 'disabled';
    if (hasError) return 'error';
    if (isFocused) return 'focus';
    return 'default';
  };

  const containerClass = cn('flex flex-col gap-1.5 items-start w-full', className);

  const inputWrapperClass = cn(
    textInputWrapper({ size, state: getState() }),
    disabled && 'cursor-not-allowed',
    'bg-background',
  );

  return (
    <div
      data-slot='text-input'
      className={containerClass}
      aria-disabled={disabled ?? false}
      data-has-error={hasError ? 'true' : 'false'}
    >
      {/* Label */}
      {label && (
        <label id={labelId} htmlFor={inputId} className='flex flex-col text-sm font-medium'>
          <span>
            {label} {rest.required && <span className='text-destructive'>*</span>}
          </span>
          {sublabel && (
            <span className='text-xs text-muted-foreground font-normal'>{sublabel}</span>
          )}
        </label>
      )}
      <div
        className={inputWrapperClass}
        data-disabled={disabled ?? false}
        data-has-error={hasError ? 'true' : 'false'}
      >
        {/* left slot ~ addon */}
        {leftSlot && (
          <div className={cn(inputGroupAddonVariants({ align: 'inline-start' }))} aria-hidden>
            {leftSlot}
          </div>
        )}
        <Input
          {...rest}
          id={inputId}
          ref={ref}
          value={value}
          onChange={onChange}
          onBlur={handleBlur}
          disabled={disabled}
          onFocus={handleFocus}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          data-slot='input'
          className='flex-1 min-w-0 bg-transparent border-none focus-visible:ring-0 px-3 py-2 disabled:cursor-not-allowed'
          style={{ cursor }}
        />

        {/* rigjht slot ~ addon */}
        {rightSlot && (
          <div className={cn(inputGroupAddonVariants({ align: 'inline-end' }))} aria-hidden>
            {rightSlot}
          </div>
        )}
      </div>

      {/* Footer: hint or error */}
      {(hasError || hintText) && (
        <div className='px-1'>
          {hasError ? (
            <p id={errorId} role='alert' className='text-sm text-destructive'>
              {errorMessage}
            </p>
          ) : (
            hintText && (
              <p id={hintId} className='text-xs text-muted-foreground'>
                {hintText}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
});

TextInput.displayName = 'TextInput';
export default TextInput;
