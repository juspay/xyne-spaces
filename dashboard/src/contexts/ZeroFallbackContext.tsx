import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiInstance } from '../services/clients/apiClient';
import { websocketService } from '../services/clients/socketClient';

export interface ZeroFallbackConfig {
  fallbackEnabled: boolean;
  allowMutations: boolean;
  pollIntervalMs: number;
}

const DEFAULT_CONFIG: ZeroFallbackConfig = {
  fallbackEnabled: false,
  allowMutations: true,
  pollIntervalMs: 15000, // Default 15 seconds
};

const ZeroFallbackContext = createContext<ZeroFallbackConfig>(DEFAULT_CONFIG);

export const ZeroFallbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<ZeroFallbackConfig>(DEFAULT_CONFIG);
  const hasFetched = useRef(false);

  const handleConfigUpdate = useCallback((data: ZeroFallbackConfig) => {
    setConfig(data);
  }, []);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    apiInstance
      .get<ZeroFallbackConfig>('/zero/fallback-config')
      .then(res => {
        setConfig(res.data);
      })
      .catch(() => {
        // Ignore errors and use default config
      });

    let mounted = true;
    const setupWebSocket = async () => {
      try {
        // Ensure WebSocket is connected (safe to call multiple times)
        await websocketService.connect();

        if (!mounted) return;

        // eslint-disable-next-line no-console
        console.log('[ZeroFallback] WebSocket connected, registering config listener');
        websocketService.on<ZeroFallbackConfig>('zero_fallback_config_updated', handleConfigUpdate);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[ZeroFallback] Failed to connect WebSocket:', error);
      }
    };

    const handleReconnect = () => {
      if (!mounted) return;
      // eslint-disable-next-line no-console
      console.log('[ZeroFallback] WebSocket reconnected, re-registering config listener');
      websocketService.on<ZeroFallbackConfig>('zero_fallback_config_updated', handleConfigUpdate);
    };

    // Listen for reconnection
    websocketService.on('connect', handleReconnect);
    // Initiate connection and setup
    void setupWebSocket();

    return () => {
      mounted = false;
      websocketService.removeListener<ZeroFallbackConfig>(
        'zero_fallback_config_updated',
        handleConfigUpdate,
      );
      websocketService.removeListener('connect', handleReconnect);
    };
  }, []);

  return <ZeroFallbackContext.Provider value={config}>{children}</ZeroFallbackContext.Provider>;
};

export const useZeroFallbackConfig = (): ZeroFallbackConfig => {
  return useContext(ZeroFallbackContext);
};
