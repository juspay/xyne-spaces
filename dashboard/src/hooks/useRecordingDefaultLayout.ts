import { useSyncExternalStore } from 'react';
import type { RecordingLayout } from '../stores/recordingStore';

export const RECORDING_DEFAULT_LAYOUT_KEY = 'xyne:recording-default-layout';

export const DEFAULT_LAYOUT: RecordingLayout = 'transcript';

const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): string => localStorage.getItem(RECORDING_DEFAULT_LAYOUT_KEY) ?? '';
const getServerSnapshot = (): string => DEFAULT_LAYOUT;

const parseLayout = (raw: string): RecordingLayout => {
  if (raw === 'transcript' || raw === 'split' || raw === 'notes') {
    return raw;
  }
  return DEFAULT_LAYOUT;
};

export const getRecordingDefaultLayout = (): RecordingLayout => {
  const raw = localStorage.getItem(RECORDING_DEFAULT_LAYOUT_KEY) ?? '';
  return parseLayout(raw);
};

const saveLayout = (layout: RecordingLayout): void => {
  localStorage.setItem(RECORDING_DEFAULT_LAYOUT_KEY, layout);
  listeners.forEach(l => l());
};

export const useRecordingDefaultLayout = (): {
  recordingDefaultLayout: RecordingLayout;
  setRecordingDefaultLayout: (layout: RecordingLayout) => void;
} => {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const layout = parseLayout(raw);

  const setRecordingDefaultLayout = (value: RecordingLayout): void => {
    saveLayout(value);
  };

  return {
    recordingDefaultLayout: layout,
    setRecordingDefaultLayout,
  };
};
