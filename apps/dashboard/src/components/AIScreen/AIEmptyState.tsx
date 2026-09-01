import { useAuth } from '../../hooks/useAuth';
import type { ReactElement } from 'react';

/**
 * Time-aware greeting heading ("Good morning, Om") extracted from the user's email.
 * Styled exactly like xyne-search/ui2 EmptyState component.
 */

const timeGreeting = (now = new Date()): string => {
  const h = now.getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const firstName = (email?: string): string | undefined => {
  if (!email) return undefined;
  const local = email.split('@')[0] ?? '';
  const first = local.split(/[._-]+/)[0];
  if (!first) return undefined;
  return first.charAt(0).toUpperCase() + first.slice(1);
};

interface AIEmptyStateProps {
  className?: string;
}

export function AIEmptyState({ className }: AIEmptyStateProps): ReactElement {
  const { user } = useAuth();
  const greet = timeGreeting();
  const display = firstName(user?.email);

  return (
    <h1
      className={
        'animate-fadeUp text-center text-[24px] font-normal leading-tight tracking-tight text-foreground ' +
        (className ?? '')
      }
    >
      {greet}
      {display ? `, ${display}` : ''}
    </h1>
  );
}
