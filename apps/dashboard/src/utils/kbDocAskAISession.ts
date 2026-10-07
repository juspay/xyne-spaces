/**
 * Remembers which Ask AI conversation belongs to which Knowledge Base file, so
 * "Ask AI about this file" reopens the chat the user already had about it
 * instead of a blank one.
 *
 * Conversations themselves live in xyne-claw and carry no link back to the
 * file they were about, so the link is kept client-side (same approach as the
 * desk `xd-ai-session:<threadId>` key in useDeskAIDraft). Keyed by user, agent
 * and file: claw sessions are per agent, and a shared browser must not hand
 * one user's session id to another.
 */

const KEY_PREFIX = 'xyne-ai-kb-doc-session';

export interface KbDocAskAISessionKey {
  userId: string | null | undefined;
  agentSlug: string | null | undefined;
  docId: string | null | undefined;
}

export function kbDocAskAISessionStorageKey({
  userId,
  agentSlug,
  docId,
}: KbDocAskAISessionKey): string | null {
  if (!userId || !docId) return null;
  return `${KEY_PREFIX}:${userId}:${agentSlug || 'ask-ai'}:${docId}`;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function getKbDocAskAISession(key: KbDocAskAISessionKey): string | null {
  const storageKey = kbDocAskAISessionStorageKey(key);
  if (!storageKey) return null;
  try {
    return storage()?.getItem(storageKey) || null;
  } catch {
    return null;
  }
}

export function setKbDocAskAISession(key: KbDocAskAISessionKey, sessionId: string): void {
  const storageKey = kbDocAskAISessionStorageKey(key);
  if (!storageKey || !sessionId) return;
  try {
    storage()?.setItem(storageKey, sessionId);
  } catch {
    // Quota / private mode: losing the link only means the next open is fresh.
  }
}

export function clearKbDocAskAISession(key: KbDocAskAISessionKey): void {
  const storageKey = kbDocAskAISessionStorageKey(key);
  if (!storageKey) return;
  try {
    storage()?.removeItem(storageKey);
  } catch {
    // ignore
  }
}
