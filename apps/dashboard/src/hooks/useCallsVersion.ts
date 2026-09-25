import { useSyncExternalStore } from 'react';

export const CALLS_VERSION_STORAGE_KEY = 'xyne:calls-version';

export type CallsVersion = 'v1' | 'v2';

const DEFAULT_CALLS_VERSION: CallsVersion = 'v1';

const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): string => localStorage.getItem(CALLS_VERSION_STORAGE_KEY) ?? '';
const getServerSnapshot = (): string => DEFAULT_CALLS_VERSION;

const parseVersion = (raw: string): CallsVersion =>
  raw === 'v2' || raw === 'v1' ? raw : DEFAULT_CALLS_VERSION;

const saveVersion = (version: CallsVersion): void => {
  localStorage.setItem(CALLS_VERSION_STORAGE_KEY, version);
  listeners.forEach(listener => listener());
};

export const useCallsVersion = (): {
  callsVersion: CallsVersion;
  setCallsVersion: (version: CallsVersion) => void;
} => {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const callsVersion = parseVersion(raw);

  return {
    callsVersion,
    setCallsVersion: saveVersion,
  };
};
