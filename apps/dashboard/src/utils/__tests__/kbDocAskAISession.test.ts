import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearKbDocAskAISession,
  getKbDocAskAISession,
  kbDocAskAISessionStorageKey,
  setKbDocAskAISession,
} from '../kbDocAskAISession';

describe('kbDocAskAISession', () => {
  // The dashboard runs vitest in the node environment, so give the helper a
  // minimal in-memory localStorage.
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips a session id per user, agent and file', () => {
    const key = { userId: 'u1', agentSlug: 'ask-ai', docId: 'doc1' };
    expect(getKbDocAskAISession(key)).toBeNull();
    setKbDocAskAISession(key, 'sess-1');
    expect(getKbDocAskAISession(key)).toBe('sess-1');
  });

  it('keeps files, agents and users isolated', () => {
    setKbDocAskAISession({ userId: 'u1', agentSlug: 'ask-ai', docId: 'doc1' }, 'sess-1');
    expect(getKbDocAskAISession({ userId: 'u1', agentSlug: 'ask-ai', docId: 'doc2' })).toBeNull();
    expect(getKbDocAskAISession({ userId: 'u1', agentSlug: 'other', docId: 'doc1' })).toBeNull();
    expect(getKbDocAskAISession({ userId: 'u2', agentSlug: 'ask-ai', docId: 'doc1' })).toBeNull();
  });

  it('defaults a missing agent slug to ask-ai', () => {
    setKbDocAskAISession({ userId: 'u1', agentSlug: null, docId: 'doc1' }, 'sess-1');
    expect(getKbDocAskAISession({ userId: 'u1', agentSlug: 'ask-ai', docId: 'doc1' })).toBe(
      'sess-1',
    );
  });

  it('is a no-op without a user or file', () => {
    expect(kbDocAskAISessionStorageKey({ userId: null, agentSlug: 'a', docId: 'd' })).toBeNull();
    expect(kbDocAskAISessionStorageKey({ userId: 'u', agentSlug: 'a', docId: '' })).toBeNull();
    setKbDocAskAISession({ userId: '', agentSlug: 'a', docId: 'd' }, 'sess');
    expect(store.size).toBe(0);
  });

  it('clears a stale link', () => {
    const key = { userId: 'u1', agentSlug: 'ask-ai', docId: 'doc1' };
    setKbDocAskAISession(key, 'sess-1');
    clearKbDocAskAISession(key);
    expect(getKbDocAskAISession(key)).toBeNull();
  });
});
