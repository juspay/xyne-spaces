import { lotusStorage } from '@/src/storage/mmkv';

export { lotusStorage };
export { withMmkvCaller, importSharedMmkvCache } from '@/src/storage/mmkv';

export function getString(key: string): string | null {
  return lotusStorage.getString(key) ?? null;
}

export function setString(key: string, value: string): void {
  lotusStorage.set(key, value);
}

export function getBoolean(key: string): boolean | null {
  const value = lotusStorage.getBoolean(key);
  return value === undefined ? null : value;
}

export function setBoolean(key: string, value: boolean): void {
  lotusStorage.set(key, value);
}

export function getJson<T>(key: string): T | null {
  const raw = getString(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    lotusStorage.remove(key);
    return null;
  }
}

export function setJson(key: string, value: unknown): void {
  lotusStorage.set(key, JSON.stringify(value));
}

export function deleteKeys(keys: readonly string[]): void {
  for (const key of keys) {
    lotusStorage.remove(key);
  }
}

export function getAllKeys(): string[] {
  return lotusStorage.getAllKeys();
}
