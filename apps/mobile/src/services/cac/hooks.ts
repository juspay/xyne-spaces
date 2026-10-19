import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { cacService } from './CacService';
import { CAC_KEYS, CAC_QUERY_KEY } from './constants';
import type { CacConfigOf, CacKey, UpdatePromptDecision } from './types';

type UseCacConfigOptions = {
  enabled?: boolean;
};

export type UseCacConfigResult<K extends CacKey> = UseQueryResult<CacConfigOf<K>, Error> & {
  config: CacConfigOf<K>;
};

/** Generic typed CAC fetch hook. Prefer config-specific hooks (e.g. useLotusUpdatePrompt) from components. */
export function useCacConfig<K extends CacKey>(
  key: K,
  options: UseCacConfigOptions = {},
): UseCacConfigResult<K> {
  const { enabled = true } = options;
  const staleTimeMs = cacService.getStaleTimeMs(key);

  const query = useQuery<CacConfigOf<K>, Error>({
    queryKey: [CAC_QUERY_KEY, key],
    enabled,
    queryFn: () => cacService.fetch(key),
    staleTime: staleTimeMs,
    gcTime: 6 * staleTimeMs,
    retry: 1,
    refetchOnMount: false,
    refetchOnReconnect: true,
  });

  return {
    ...query,
    config: query.data ?? cacService.getDefault(key),
  };
}

export type UseLotusUpdatePromptResult = {
  visible: boolean;
  decision: UpdatePromptDecision;
  dismissOptional: () => void;
  isLoading: boolean;
};

/**
 * Lotus update prompt — fetch CAC config, evaluate, and drive visibility.
 * Components only need this; all processing lives in {@link CacService}.
 */
export function useLotusUpdatePrompt(enabled: boolean): UseLotusUpdatePromptResult {
  const { config, isLoading, isFetched, refetch } = useCacConfig(CAC_KEYS.lotusUpdateConfig, {
    enabled,
  });

  console.log('useLotusUpdatePrompt', JSON.stringify({ config, isLoading, isFetched }, null, 2));

  const [visible, setVisible] = useState(false);

  const decision = useMemo((): UpdatePromptDecision => {
    if (!isFetched) return { kind: 'none' };
    return cacService.resolveUpdateDecision(config);
  }, [config, isFetched]);

  useEffect(() => {
    setVisible(cacService.shouldShowPrompt(decision));
  }, [decision]);

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void refetch();
      }
    });
    return () => sub.remove();
  }, [enabled, refetch]);

  const dismissOptional = () => {
    cacService.dismissOptionalPrompt(decision);
    if (decision.kind === 'optional') {
      setVisible(false);
    }
  };

  return {
    visible,
    decision,
    dismissOptional,
    isLoading,
  };
}
