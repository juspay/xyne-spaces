import type { ButtonHTMLAttributes, ReactElement } from 'react';
import { cn } from '../../utils/classNames';

interface SuggestionPillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The pill a row leads with, such as a confirmation: filled with the primary colour. */
  primary?: boolean;
}

/** A rounded pill Ask AI offers to tap: a follow-up, a starter, or one of Buddy's choices. */
export const SuggestionPill = ({
  primary = false,
  className,
  type = 'button',
  ...props
}: SuggestionPillProps): ReactElement => (
  <button
    type={type}
    className={cn(
      'rounded-full border px-3 py-1.5 text-left text-xs font-medium leading-5 transition-colors disabled:pointer-events-none disabled:opacity-50',
      primary
        ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
        : 'border-border bg-card text-muted-foreground hover:bg-accent',
      className,
    )}
    {...props}
  />
);
