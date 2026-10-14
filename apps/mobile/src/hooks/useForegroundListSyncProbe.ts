import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export type ForegroundListSyncProbe = {
  startedAtMs: number;
  latestItemAt: number;
  cacheRowCount: number;
};

type UseForegroundListSyncProbeOptions = {
  enabled: boolean;
  identityKey: string | null;
  getLatestItemAt: () => number;
  getRowCount: () => number;
};

type ProbeRef = ForegroundListSyncProbe & {
  identityKey: string;
  foregroundVersion: number;
};

const MAX_FOREGROUND_PROBE_AGE_MS = 60_000;

let lastForegroundAtMs: number | null = null;
let foregroundVersion = 0;
let previousAppState: AppStateStatus = AppState.currentState;
let didInstallForegroundListener = false;
const foregroundSubscribers = new Set<() => void>();

export const ensureForegroundListSyncProbeListener = (): void => {
  if (didInstallForegroundListener) {
    return;
  }

  didInstallForegroundListener = true;
  AppState.addEventListener('change', nextState => {
    if (previousAppState !== 'active' && nextState === 'active') {
      lastForegroundAtMs = performance.now();
      foregroundVersion += 1;
      for (const notify of foregroundSubscribers) {
        notify();
      }
    }

    previousAppState = nextState;
  });
};

export const useForegroundListSyncProbe = ({
  enabled,
  identityKey,
  getLatestItemAt,
  getRowCount,
}: UseForegroundListSyncProbeOptions) => {
  const probeRef = useRef<ProbeRef | null>(null);
  const optionsRef = useRef({ enabled, identityKey, getLatestItemAt, getRowCount });
  optionsRef.current = { enabled, identityKey, getLatestItemAt, getRowCount };

  const armProbe = useCallback((): void => {
    const options = optionsRef.current;
    if (
      !options.enabled ||
      !options.identityKey ||
      lastForegroundAtMs === null ||
      performance.now() - lastForegroundAtMs > MAX_FOREGROUND_PROBE_AGE_MS
    ) {
      probeRef.current = null;
      return;
    }

    probeRef.current = {
      identityKey: options.identityKey,
      foregroundVersion,
      startedAtMs: lastForegroundAtMs,
      latestItemAt: options.getLatestItemAt(),
      cacheRowCount: options.getRowCount(),
    };
  }, []);

  useEffect(() => {
    ensureForegroundListSyncProbeListener();
    foregroundSubscribers.add(armProbe);
    armProbe();
    return (): void => {
      foregroundSubscribers.delete(armProbe);
    };
  }, [armProbe]);

  const consumeIfNewer = useCallback(
    (latestItemAt: number): ForegroundListSyncProbe | null => {
      const probe = probeRef.current;
      if (!probe || !identityKey || probe.identityKey !== identityKey) {
        return null;
      }
      if (probe.foregroundVersion !== foregroundVersion) {
        probeRef.current = null;
        return null;
      }
      if (performance.now() - probe.startedAtMs > MAX_FOREGROUND_PROBE_AGE_MS) {
        probeRef.current = null;
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
    [identityKey],
  );

  return { consumeIfNewer };
};
