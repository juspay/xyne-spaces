import { useCallback, useSyncExternalStore } from 'react';

export const ASK_AI_VERSION_STORAGE_KEY = 'xyne-ask-ai-version';

// Bump this flag's suffix if you ever need to force-migrate everyone again.
const ASK_AI_V2_MIGRATION_FLAG = 'xyne-ask-ai-v2-default-migrated';

export type AskAIVersion = 'v1' | 'v2';

const DEFAULT_ASK_AI_VERSION: AskAIVersion = 'v2';

/**
 * One-time migration: v2 is now the default for everyone. Users who were on the
 * old v1 default have 'v1' persisted in localStorage, which would otherwise keep
 * them on v1 forever. Flip those to v2 once, then record that we did so. Runs
 * only once per browser — later manual toggles (Settings → Preferences) stick.
 */
function migrateToV2Default(): void {
  if (localStorage.getItem(ASK_AI_V2_MIGRATION_FLAG)) return;
  if (localStorage.getItem(ASK_AI_VERSION_STORAGE_KEY) === 'v1') {
    localStorage.setItem(ASK_AI_VERSION_STORAGE_KEY, 'v2');
  }
  localStorage.setItem(ASK_AI_V2_MIGRATION_FLAG, '1');
}

function getStoredVersion(): AskAIVersion {
  migrateToV2Default();
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
