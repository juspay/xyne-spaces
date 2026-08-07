/**
 * Chrome storage abstraction for the browser extension.
 * Provides type-safe access to chrome.storage.local.
 */

export interface StorageData {
  xyne_spaces_token?: string;
  xyne_spaces_base_url?: string;
  xyne_spaces_user?: {
    id: string;
    email: string;
    name: string;
    workspaceId: string;
  };
}

type StorageKey = keyof StorageData;

/**
 * Get a value from chrome.storage.local
 */
export async function getStorage<K extends StorageKey>(
  key: K
): Promise<StorageData[K] | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key];
}

/**
 * Get multiple values from chrome.storage.local
 */
export async function getStorageMultiple<K extends StorageKey>(
  keys: K[]
): Promise<Pick<StorageData, K>> {
  const result = await chrome.storage.local.get(keys);
  return result as Pick<StorageData, K>;
}

/**
 * Set a value in chrome.storage.local
 */
export async function setStorage<K extends StorageKey>(
  key: K,
  value: StorageData[K]
): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

/**
 * Set multiple values in chrome.storage.local
 */
export async function setStorageMultiple(
  data: Partial<StorageData>
): Promise<void> {
  await chrome.storage.local.set(data);
}

/**
 * Remove a value from chrome.storage.local
 */
export async function removeStorage(key: StorageKey): Promise<void> {
  await chrome.storage.local.remove(key);
}

/**
 * Remove multiple values from chrome.storage.local
 */
export async function removeStorageMultiple(keys: StorageKey[]): Promise<void> {
  await chrome.storage.local.remove(keys);
}

/**
 * Clear all extension storage
 */
export async function clearStorage(): Promise<void> {
  await chrome.storage.local.clear();
}
