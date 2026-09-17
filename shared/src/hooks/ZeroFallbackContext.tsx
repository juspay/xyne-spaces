import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

export interface ZeroFallbackConfig {
  fallbackEnabled: boolean;
  allowMutations: boolean;
  pollIntervalMs: number;
  /**
   * Optional: when true, the Zero query stays subscribed even while fallback
   * is enabled, so it can hydrate IVM in the background while fallback serves
   * the UI. Apps with a "flip fallback off once Zero is ready" latch want
   * this. Default false → original behavior: Zero is disabled while fallback
   * is on (no parallel IVM hydration cost).
   */
  keepZeroAlongsideFallback?: boolean;
  /**
   * Optional: fired the first time any useQuery's Zero result reports
   * `details.type === 'complete'`. Apps use this as the "Zero is ready"
   * signal — e.g. to flip a latch that disables fallback for the rest of
   * the session.
   */
  onZeroComplete?: () => void;
}

const DEFAULT_CONFIG: ZeroFallbackConfig = {
  fallbackEnabled: false,
  allowMutations: true,
  pollIntervalMs: 15000,
};

export const ZeroFallbackContext = createContext<ZeroFallbackConfig>(DEFAULT_CONFIG);

export const DEFAULT_ZERO_FALLBACK_CONFIG: ZeroFallbackConfig = DEFAULT_CONFIG;

/**
 * Platform services needed by ZeroFallbackProvider.
 * Each app provides its own API client and WebSocket service.
 */
export interface FallbackPlatformServices {
  fetchFallbackConfig: () => Promise<ZeroFallbackConfig>;
  onConfigUpdate: (callback: (config: ZeroFallbackConfig) => void) => void;
  offConfigUpdate: (callback: (config: ZeroFallbackConfig) => void) => void;
}

interface ZeroFallbackProviderProps {
  services: FallbackPlatformServices;
  children: React.ReactNode;
}

export const ZeroFallbackProvider: React.FC<ZeroFallbackProviderProps> = ({
  services,
  children,
}) => {
  const [config, setConfig] = useState<ZeroFallbackConfig>(DEFAULT_CONFIG);
  const hasFetched = useRef(false);

  const handleConfigUpdate = useCallback((data: ZeroFallbackConfig) => {
    setConfig(data);
  }, []);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    services
      .fetchFallbackConfig()
      .then(setConfig)
      .catch(() => {
        // Ignore errors and use default config
      });

    services.onConfigUpdate(handleConfigUpdate);

    return () => {
      services.offConfigUpdate(handleConfigUpdate);
    };
  }, []);

  return <ZeroFallbackContext.Provider value={config}>{children}</ZeroFallbackContext.Provider>;
};

export const useZeroFallbackConfig = (): ZeroFallbackConfig => {
  return useContext(ZeroFallbackContext);
};
