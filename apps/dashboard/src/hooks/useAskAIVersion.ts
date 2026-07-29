import { useCallback } from 'react';

export const ASK_AI_VERSION_STORAGE_KEY = 'xyne-ask-ai-version';

export type AskAIVersion = 'v1' | 'v2';

// Ask AI v1 has been fully removed. Everything runs on v2 (xyne-claw) now.
// The exports are kept as no-op-compatible shims so existing call sites keep
// compiling; the version is always 'v2'.
const ASK_AI_VERSION: AskAIVersion = 'v2';

export const useAskAIVersion = () => {
  const setAskAIVersion = useCallback((_version: AskAIVersion) => {
    // no-op: v1 removed, version is permanently v2
  }, []);

  const toggleAskAIVersion = useCallback(() => {
    // no-op: v1 removed, version is permanently v2
  }, []);

  return {
    askAIVersion: ASK_AI_VERSION,
    setAskAIVersion,
    toggleAskAIVersion,
  };
};
