import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../utils/classNames';

/**
 * A browser toolbar's icon button: quiet until pointed at or reached by keyboard,
 * faded while it can't act. Named by its label, which is also its tooltip.
 */
export const ToolbarButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    label: string;
    trackCategory: string;
    trackName: string;
    /** Held down, as a toggle that is on. */
    pressed?: boolean;
    children: ReactNode;
  }
>(function ToolbarButton(props, ref) {
  const { label, trackCategory, trackName, pressed, disabled, className, children, ...rest } =
    props;
  return (
    <button
      ref={ref}
      type='button'
      title={label}
      aria-label={label}
      {...(pressed !== undefined && { 'aria-pressed': pressed })}
      disabled={disabled}
      {...rest}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors',
        disabled
          ? 'text-muted-foreground/40'
          : pressed
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground focus-visible:bg-foreground/[0.08] focus-visible:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground',
        className,
      )}
      data-track-category={trackCategory}
      data-track-name={trackName}
    >
      {children}
    </button>
  );
});
