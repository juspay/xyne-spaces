import * as React from 'react';
import { cn } from '../../../utils/classNames';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        data-slot='textarea'
        className={cn(
          'file:text-foreground placeholder:text-muted-foreground dark:bg-input/30 border-input min-h-[80px] w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none resize-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          'focus-visible:border-ring focus-visible:ring-ring/10 focus-visible:ring-[2px]',
          'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);

export default Textarea;
