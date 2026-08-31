import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../../utils/classNames';
import { Loader2 } from 'lucide-react';
import {
  posthogService,
  type EventProperties,
} from '../../../services/Analytics/posthogService';

/**
 * Derive a human-readable label for a button click event.
 * Prefers an explicit data-track-name, then aria-label/title, then text content.
 */
function deriveButtonLabel(
  props: Record<string, unknown>,
  children: React.ReactNode,
): string {
  const explicit =
    (props['data-track-name'] as string | undefined) ??
    (props['aria-label'] as string | undefined) ??
    (props['title'] as string | undefined);
  if (explicit && explicit.trim() !== '') {
    return explicit;
  }
  if (typeof children === 'string' && children.trim() !== '') {
    return children.trim();
  }
  if (Array.isArray(children)) {
    const text = children.find(child => typeof child === 'string');
    if (typeof text === 'string' && text.trim() !== '') {
      return text.trim();
    }
  }
  return 'unlabeled';
}

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*="size-"])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive cursor-pointer disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'border bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost:
          'text-foreground hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
        iconSm: 'size-8',
        iconLg: 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

interface ButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  /**
   * Stable id describing this button's PURPOSE (e.g. `send_message`,
   * `delete_channel`). When set, the button records `<trackId>_click` in PostHog,
   * and — if `trackAction` is provided — `<trackId>_success` / `<trackId>_failure`
   * so the outcome of the mutation is monitored.
   */
  trackId?: string;
  /**
   * The action this button performs. When provided, the Button runs it, shows a
   * loading spinner while it is pending, and records the pass/fail outcome in
   * PostHog under `trackId`. Sync or async; thrown errors are captured as a
   * failure (and swallowed so analytics never breaks the UI — the action itself
   * should surface user-facing errors, e.g. via toasts).
   */
  trackAction?: (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => void | Promise<void>;
  /** Extra metadata attached to every tracking event for this button. */
  trackProps?: EventProperties;
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  onClick,
  trackId,
  trackAction,
  trackProps,
  ...props
}: ButtonProps): React.JSX.Element {
  const Comp = asChild ? Slot : 'button';
  const [pending, setPending] = React.useState(false);
  const isDisabled = disabled || loading || pending;

  const handleClick = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>): Promise<void> => {
      // Monitor every button click in PostHog with a readable label. This runs
      // alongside PostHog autocapture and never blocks the original handler.
      try {
        posthogService.captureButtonClick(deriveButtonLabel(props, children), {
          variant: variant ?? 'default',
          size: size ?? 'default',
          ...(trackId ? { trackId } : {}),
          ...trackProps,
        });
        if (trackId) {
          posthogService.captureActionOutcome(trackId, 'click', trackProps);
        }
      } catch {
        // Never let analytics break a click.
      }

      // When a trackAction is supplied, the Button owns the pass/fail lifecycle.
      if (trackAction) {
        setPending(true);
        try {
          await trackAction(event);
          if (trackId) {
            posthogService.captureActionOutcome(trackId, 'success', trackProps);
          }
        } catch (error) {
          if (trackId) {
            posthogService.captureActionOutcome(trackId, 'failure', {
              ...trackProps,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          // Swallow: the action is responsible for user-facing error handling.
        } finally {
          setPending(false);
        }
        return;
      }

      onClick?.(event);
    },
    [onClick, props, children, variant, size, trackId, trackAction, trackProps],
  );

  return (
    <Comp
      data-slot='button'
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={isDisabled}
      onClick={handleClick}
      {...props}
    >
      {(loading || pending) && <Loader2 className='size-4 animate-spin' />}
      {children}
    </Comp>
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
