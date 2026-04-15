import React, { useEffect, ReactNode } from 'react';
import { mixpanelService, EVENTS } from '../services/Analytics/mixpanelService';
import { usePlatform } from '../hooks/usePlatform';

interface AnalyticsProviderProps {
  children: ReactNode;
}

/**
 * AnalyticsProvider initializes Mixpanel on mount
 * Use mixpanelService.track() or sudoQueryService.track() directly in components for tracking events
 */
export const AnalyticsProvider: React.FC<AnalyticsProviderProps> = ({ children }) => {
  const { platform } = usePlatform();

  useEffect(() => {
    mixpanelService.initialize();
    mixpanelService.setPlatform(platform);

    // Track app open for DAU/MAU metrics
    mixpanelService.track(EVENTS.APP_OPEN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
};
