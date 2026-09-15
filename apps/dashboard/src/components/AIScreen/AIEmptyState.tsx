import { useAuth } from '../../hooks/useAuth';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

/**
 * Time-aware greeting heading ("Good morning, Om") extracted from the user's email.
 * Styled exactly like xyne-search/ui2 EmptyState component.
 */

const timeGreeting = (t: TFunction, now = new Date()): string => {
  const h = now.getHours();
  if (h < 5) return t('aiScreen.emptyState.workingLate');
  if (h < 12) return t('aiScreen.emptyState.goodMorning');
  if (h < 17) return t('aiScreen.emptyState.goodAfternoon');
  return t('aiScreen.emptyState.goodEvening');
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
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const greet = timeGreeting(t);
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
