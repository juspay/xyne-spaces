import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../../utils/classNames';

const inputVariants = cva(
  cn(
    'file:text-foreground placeholder:text-muted-foreground h-9 w-full min-w-0 border px-3 py-1 text-base text-foreground transition-[color,box-shadow] outline-none',
    'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
    'focus-visible:border-ring focus-visible:ring-ring/10 focus-visible:ring-[2px]',
    'aria-invalid:ring-destructive/20 aria-invalid:border-destructive',
  ),
  {
    variants: {
      variant: {
        default: 'rounded-md border-input bg-transparent shadow-xs',
        flat: 'rounded-[10px] border-border bg-background',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type InputProps = React.ComponentProps<'input'> & VariantProps<typeof inputVariants>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, ...props }, ref) => {
    return (
      <input
        type={type}
        data-slot='input'
        ref={ref}
        className={cn(inputVariants({ variant }), className)}
        {...props}
      />
    );
  },
);

Input.displayName = 'Input';

export { inputVariants };
export default Input;
