import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../../utils/classNames';
import { Loader2 } from 'lucide-react';
import { type EventProperties } from '../../../services/Analytics/posthogService';

/**
 * Convert tracking metadata into PostHog-native capture attributes. Any element
 * attribute prefixed `data-ph-capture-attribute-*` is automatically attached to
 * the autocaptured click event by PostHog, so we surface the button's purpose
 * without emitting a separate custom event.
 */
function buildCaptureAttributes(
  trackId: string | undefined,
  trackProps: EventProperties | undefined,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (trackId && trackId.trim() !== '') {
    attrs['data-ph-capture-attribute-track-id'] = trackId;
  }
  if (trackProps) {
    for (const [key, value] of Object.entries(trackProps)) {
      if (value !== undefined && value !== null) {
        attrs[`data-ph-capture-attribute-${key}`] =
          typeof value === 'object' ? JSON.stringify(value) : String(value);
      }
    }
  }
  return attrs;
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
   * `delete_channel`). Surfaced to PostHog autocapture as the
   * `data-ph-capture-attribute-track-id` element attribute so the autocaptured
   * click carries a readable, queryable purpose.
   */
  trackId?: string;
  /**
   * The action this button performs. When provided, the Button runs it and shows
   * a loading spinner while it is pending, blocking double-submits. Sync or
   * async; thrown errors are swallowed so a failing action never leaves the
   * button stuck spinning — the action itself is responsible for user-facing
   * error handling (e.g. toasts). Note: when set, `onClick` is not called; move
   * the click work into `trackAction`.
   */
  trackAction?: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  /**
   * Extra metadata surfaced to PostHog autocapture as
   * `data-ph-capture-attribute-<key>` element attributes.
   */
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

  const captureAttributes = React.useMemo(
    () => buildCaptureAttributes(trackId, trackProps),
    [trackId, trackProps],
  );

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>): void => {
      // Clicks are recorded by PostHog autocapture; the Button only owns the
      // action lifecycle here. When a trackAction is supplied, run it with a
      // pending spinner that blocks double-submits.
      if (trackAction) {
        setPending(true);
        void (async (): Promise<void> => {
          try {
            await trackAction(event);
          } catch {
            // Swallow: the action is responsible for user-facing error handling;
            // this only clears the spinner so the button never gets stuck.
          } finally {
            setPending(false);
          }
        })();
        return;
      }

      onClick?.(event);
    },
    [onClick, trackAction],
  );

  return (
    <Comp
      data-slot='button'
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={isDisabled}
      onClick={handleClick}
      {...captureAttributes}
      {...props}
    >
      {(loading || pending) && <Loader2 className='size-4 animate-spin' />}
      {children}
    </Comp>
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
