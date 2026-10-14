import { getJson, setJson, lotusStorage } from './localStorage';
import type { StoredSettings } from '@/src/machines/settingsMachine.schema';

import { clearStoredThemePreference } from './themePreferenceStorage';
import { clearStoredChatBubblePreference } from './chatBubblePreferenceStorage';

const SETTINGS_STORAGE_KEY = 'settings:v1';

export const readStoredSettings = (): StoredSettings | null =>
  getJson<StoredSettings>(SETTINGS_STORAGE_KEY);

export const writeStoredSettings = (payload: StoredSettings): void => {
  setJson(SETTINGS_STORAGE_KEY, payload);
};

export const clearStoredSettings = (): void => {
  lotusStorage.remove(SETTINGS_STORAGE_KEY);
  clearStoredThemePreference();
  clearStoredChatBubblePreference();
};
