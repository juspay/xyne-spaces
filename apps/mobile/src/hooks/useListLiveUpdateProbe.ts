import { useCallback, useRef } from 'react';

export type ListLiveUpdateProbe = {
  startedAtMs: number;
  latestItemAt: number;
  cacheRowCount: number;
};

type StoredListLiveUpdateProbe = ListLiveUpdateProbe & {
  identityKey: string;
};

export const useListLiveUpdateProbe = () => {
  const probeRef = useRef<StoredListLiveUpdateProbe | null>(null);

  const arm = useCallback(
    (
      identityKey: string,
      startedAtMs: number,
      latestItemAt: number,
      cacheRowCount: number,
    ): void => {
      probeRef.current = {
        identityKey,
        startedAtMs,
        latestItemAt,
        cacheRowCount,
      };
    },
    [],
  );

  const consumeIfNewer = useCallback(
    (identityKey: string, latestItemAt: number): ListLiveUpdateProbe | null => {
      const probe = probeRef.current;
      if (!probe || probe.identityKey !== identityKey) {
        return null;
      }

      if (latestItemAt <= probe.latestItemAt) {
        return null;
      }

      probeRef.current = null;
      return {
        startedAtMs: probe.startedAtMs,
        latestItemAt: probe.latestItemAt,
        cacheRowCount: probe.cacheRowCount,
      };
    },
    [],
  );

  const isArmed = useCallback(
    (identityKey: string): boolean => probeRef.current?.identityKey === identityKey,
    [],
  );

  return { arm, consumeIfNewer, isArmed };
};
