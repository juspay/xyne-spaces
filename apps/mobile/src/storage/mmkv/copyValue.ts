import type { createMMKV } from 'react-native-mmkv';

type MmkvStore = ReturnType<typeof createMMKV>;

export function copyMmkvValue(source: MmkvStore, destination: MmkvStore, key: string): void {
  const stringValue = source.getString(key);
  if (stringValue !== undefined) {
    destination.set(key, stringValue);
    return;
  }
  const booleanValue = source.getBoolean(key);
  if (booleanValue !== undefined) {
    destination.set(key, booleanValue);
    return;
  }
  const numberValue = source.getNumber(key);
  if (numberValue !== undefined) {
    destination.set(key, numberValue);
  }
}
