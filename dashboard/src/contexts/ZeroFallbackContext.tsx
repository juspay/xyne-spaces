import React from 'react';
import {
  ZeroFallbackProvider as SharedZeroFallbackProvider,
  FallbackExecutorProvider,
  type FallbackPlatformServices,
} from '@xyne/shared/hooks';
import { apiInstance } from '../services/clients/apiClient';
import { websocketService } from '../services/clients/socketClient';
import { executeFallbackQuery } from '../services/zeroFallbackClient';
import type { ZeroFallbackConfig } from '@xyne/shared/hooks';

// Re-export for existing imports
export { useZeroFallbackConfig } from '@xyne/shared/hooks';
export type { ZeroFallbackConfig } from '@xyne/shared/hooks';

const dashboardFallbackServices: FallbackPlatformServices = {
  fetchFallbackConfig: () =>
    apiInstance.get<ZeroFallbackConfig>('/zero/fallback-config').then(res => res.data),

  onConfigUpdate: callback => {
    websocketService.on<ZeroFallbackConfig>('zero_fallback_config_updated', callback);
  },

  offConfigUpdate: callback => {
    websocketService.removeListener<ZeroFallbackConfig>('zero_fallback_config_updated', callback);
  },
};

/**
 * Dashboard's ZeroFallbackProvider — wraps the shared provider
 * with dashboard-specific API client and WebSocket services.
 */
export const ZeroFallbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <SharedZeroFallbackProvider services={dashboardFallbackServices}>
      <FallbackExecutorProvider value={executeFallbackQuery}>{children}</FallbackExecutorProvider>
    </SharedZeroFallbackProvider>
  );
};
