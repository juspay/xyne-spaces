import { describe, expect, it } from 'vitest';
import { parseStoredDraftChat, readDraftChat, writeDraftChat } from './draftChatStorage';

function memory(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: key => items.get(key) ?? null,
    key: index => [...items.keys()][index] ?? null,
    removeItem: key => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

const thread = {
  id: 't1',
  messages: [
    { id: 'm1', role: 'user' as const, content: 'hi' },
    { id: 'm2', role: 'assistant' as const, content: 'Hello!' },
  ],
};

describe('draft chat storage', () => {
  it('brings the conversation back with whether it was open', () => {
    const storage = memory();
    writeDraftChat('k', { threads: [thread], activeThreadId: 't1', open: true }, storage);
    expect(readDraftChat('k', storage)).toEqual({ threads: [thread], activeThreadId: 't1', open: true });
  });

  it('keeps nothing for a chat with nothing said', () => {
    const storage = memory();
    writeDraftChat('k', { threads: [{ id: 't1', messages: [] }], activeThreadId: 't1', open: false }, storage);
    expect(storage.getItem('k')).toBeNull();
  });

  it('stops a reply the reload cut off', () => {
    const stored = parseStoredDraftChat(
      JSON.stringify({
        threads: [{ id: 't1', messages: [{ id: 'm1', role: 'assistant', content: '', streaming: true }] }],
        activeThreadId: 't1',
      }),
    );
    expect(stored?.threads[0]?.messages[0]).toEqual({
      id: 'm1',
      role: 'assistant',
      content: '',
      error: 'Stopped when the page reloaded.',
    });
  });

  it('drops anything malformed', () => {
    expect(parseStoredDraftChat('not json')).toBeNull();
    expect(parseStoredDraftChat(JSON.stringify({ threads: [thread], activeThreadId: 'gone' }))).toBeNull();
  });
});
