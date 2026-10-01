import { botAvatarTypes, type BotAvatarType } from 'bot-avatars';

/** Stable shape for an agent so a roster does not reuse one body. */
export function botTypeForKey(key: string): BotAvatarType {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
  }
  return botAvatarTypes[hash % botAvatarTypes.length] ?? 'clover';
}

/** 0–1 offset so a row of avatars does not blink in unison. */
export function botSeedForKey(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}
