import React, { useEffect, ReactNode } from 'react';
import { posthogService, EVENTS } from '../services/Analytics/posthogService';
import { usePlatform } from '../hooks/usePlatform';

interface AnalyticsProviderProps {
  children: ReactNode;
}

/**
 * AnalyticsProvider initializes PostHog on mount.
 * Use posthogService.capture() directly in components for tracking events.
 */
export const AnalyticsProvider: React.FC<AnalyticsProviderProps> = ({ children }) => {
  const { platform } = usePlatform();

  useEffect(() => {
    posthogService.initialize();
    posthogService.setPlatform(platform);

    // Track app open for DAU/MAU metrics
    posthogService.capture(EVENTS.APP_OPEN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
};
