import { lotusStorage } from './localStorage';

export type PersistedThemePreference = 'light' | 'dark' | 'system';

const KEY = 'lotus.theme.preference';

export function readStoredThemePreference(): PersistedThemePreference | null {
  const raw = lotusStorage.getString(KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'system') {
    return raw;
  }
  return null;
}

export function writeStoredThemePreference(value: PersistedThemePreference): void {
  lotusStorage.set(KEY, value);
}

export function clearStoredThemePreference(): void {
  lotusStorage.remove(KEY);
}
