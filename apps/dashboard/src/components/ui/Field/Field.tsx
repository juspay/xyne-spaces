import React from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../../utils/classNames';

interface FieldErrorProps {
  error?: string | undefined;
  className?: string | undefined;
}

export const FieldError: React.FC<FieldErrorProps> = ({ error, className }) => (
  <div
    role='alert'
    aria-live='polite'
    className={cn(
      'overflow-hidden transition-[max-height,opacity] duration-200 ease-out',
      error ? 'mt-[7px] max-h-10 opacity-100' : 'hidden',
      className,
    )}
  >
    <p className='flex items-center gap-1.5 text-[11.5px] font-medium text-destructive'>
      {error && <AlertCircle size={13} strokeWidth={1.8} className='shrink-0' />}
      {error}
    </p>
  </div>
);

interface FieldLabelProps {
  children: React.ReactNode;
  required?: boolean | undefined;
  /** Marks the field "(optional)", for forms where only some fields are required. */
  optional?: boolean | undefined;
  htmlFor?: string | undefined;
  className?: string | undefined;
}

export const FieldLabel: React.FC<FieldLabelProps> = ({
  children,
  required,
  optional,
  htmlFor,
  className,
}) => (
  <label
    htmlFor={htmlFor}
    className={cn('text-[11.5px] font-semibold text-foreground/85', className)}
  >
    {children}
    {required && (
      <span aria-hidden className='ml-0.5 text-destructive'>
        *
      </span>
    )}
    {optional && <span className='ml-1 font-normal text-muted-foreground'>(optional)</span>}
  </label>
);

interface FieldProps {
  label?: React.ReactNode;
  required?: boolean | undefined;
  optional?: boolean | undefined;
  error?: string | undefined;
  htmlFor?: string | undefined;
  labelless?: boolean | undefined;
  className?: string | undefined;
  children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({
  label,
  required,
  optional,
  error,
  htmlFor,
  labelless,
  className,
  children,
}) => (
  <div className={cn('flex flex-col', className)}>
    {!labelless && label !== undefined && (
      <FieldLabel
        required={required}
        optional={optional}
        {...(htmlFor !== undefined && { htmlFor })}
      >
        {label}
      </FieldLabel>
    )}
    {children}
    <FieldError error={error} />
  </div>
);
