const storageKey = (agentSlug: string): string => `xyne-ai-fast-mode:${agentSlug}`;

export function readFastModePreference(agentSlug: string): boolean {
  try {
    return globalThis.localStorage?.getItem(storageKey(agentSlug)) === '1';
  } catch {
    return false;
  }
}

export function writeFastModePreference(agentSlug: string, enabled: boolean): void {
  try {
    if (enabled) globalThis.localStorage?.setItem(storageKey(agentSlug), '1');
    else globalThis.localStorage?.removeItem(storageKey(agentSlug));
  } catch {
    return;
  }
}
