import { cn } from "../../../lib/utils";

/**
 * Skeleton — pulsing placeholder for loading states.
 *
 * Use `className` to set exact width/height and shape.  Combine
 * with layout wrappers (flex/grid) to mimic the structure of the
 * real content.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      data-id="skeleton"
      className={cn(
        "animate-pulse rounded-md bg-xyne-surface-sunken",
        className,
      )}
    />
  );
}
