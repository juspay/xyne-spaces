import React, { useEffect, ReactNode } from 'react';
import { posthogService } from '../services/Analytics/posthogService';
import { usePlatform } from '../hooks/usePlatform';

interface AnalyticsProviderProps {
  children: ReactNode;
}

/**
 * AnalyticsProvider initializes PostHog on mount. Interaction tracking is
 * handled by PostHog autocapture (clicks/changes) plus the keyboard-shortcut
 * capture in ShortcutsProvider — no per-component capture calls in this PR.
 */
export const AnalyticsProvider: React.FC<AnalyticsProviderProps> = ({ children }) => {
  const { platform } = usePlatform();

  useEffect(() => {
    posthogService.initialize();
    posthogService.setPlatform(platform);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
};
