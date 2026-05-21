import { useCallback, useSyncExternalStore } from 'react';

export const ASK_AI_VERSION_STORAGE_KEY = 'xyne-ask-ai-version';

export type AskAIVersion = 'v1' | 'v2';

const DEFAULT_ASK_AI_VERSION: AskAIVersion = 'v1';

function getStoredVersion(): AskAIVersion {
  const stored = localStorage.getItem(ASK_AI_VERSION_STORAGE_KEY);
  if (stored === 'v1' || stored === 'v2') return stored;
  return DEFAULT_ASK_AI_VERSION;
}

let currentVersion: AskAIVersion = getStoredVersion();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AskAIVersion {
  return currentVersion;
}

function getServerSnapshot(): AskAIVersion {
  return DEFAULT_ASK_AI_VERSION;
}

function setVersion(version: AskAIVersion): void {
  currentVersion = version;
  localStorage.setItem(ASK_AI_VERSION_STORAGE_KEY, version);
  for (const listener of listeners) {
    listener();
  }
}

export const useAskAIVersion = () => {
  const askAIVersion = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setAskAIVersion = useCallback((version: AskAIVersion) => {
    setVersion(version);
  }, []);

  const toggleAskAIVersion = useCallback(() => {
    setVersion(currentVersion === 'v1' ? 'v2' : 'v1');
  }, []);

  return {
    askAIVersion,
    setAskAIVersion,
    toggleAskAIVersion,
  };
};
