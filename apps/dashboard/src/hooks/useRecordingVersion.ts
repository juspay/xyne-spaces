import { useSyncExternalStore } from 'react';

export const RECORDING_VERSION_STORAGE_KEY = 'xyne:recording-version';

export type RecordingVersion = 'v1' | 'v2';

const DEFAULT_RECORDING_VERSION: RecordingVersion = 'v2';

const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): string => localStorage.getItem(RECORDING_VERSION_STORAGE_KEY) ?? '';
const getServerSnapshot = (): string => DEFAULT_RECORDING_VERSION;

const parseVersion = (raw: string): RecordingVersion =>
  raw === 'v2' || raw === 'v1' ? raw : DEFAULT_RECORDING_VERSION;

const saveVersion = (version: RecordingVersion): void => {
  localStorage.setItem(RECORDING_VERSION_STORAGE_KEY, version);
  listeners.forEach(listener => listener());
};

export const useRecordingVersion = (): {
  recordingVersion: RecordingVersion;
  setRecordingVersion: (version: RecordingVersion) => void;
} => {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const recordingVersion = parseVersion(raw);

  return {
    recordingVersion,
    setRecordingVersion: saveVersion,
  };
};
