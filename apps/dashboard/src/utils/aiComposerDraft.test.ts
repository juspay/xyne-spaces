import { describe, expect, it } from 'vitest';
import type { ComposerContext } from '../components/AIScreen/composerContext';
import {
  AI_DRAFT_MAX_TEXT,
  AI_DRAFT_TTL_MS,
  applyDraftContext,
  buildAIDraftKey,
  isDraftEmpty,
  pruneAIDrafts,
  readAIDraft,
  toDraftContext,
  writeAIDraft,
  type DraftStorage,
} from './aiComposerDraft';

function memoryStorage(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length(): number {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

// Mirrors EMPTY_COMPOSER_CONTEXT; importing it would pull the picker UI into a node test.
const EMPTY_COMPOSER_CONTEXT: ComposerContext = {
  channels: [],
  tickets: [],
  canvases: [],
  transcripts: [],
  recordings: [],
  messages: [],
  people: [],
  sharedFiles: [],
  apps: [],
  userTags: {},
  localFolders: [],
  collections: [],
  fileScopes: [],
  folderScopes: [],
  research: null,
  webSearchEnabled: false,
  deepResearchEnabled: false,
  createCanvasEnabled: false,
  voiceMode: false,
  voiceStudioMode: null,
  instant: false,
  model: null,
  modelProvider: null,
  thinkingLevel: null,
  fast: false,
  sandboxMode: 'remote',
};

const KEY = buildAIDraftKey('ws1', 'u1', 'conv1');
const channel = { id: 'c1', name: 'general' } as unknown as ComposerContext['channels'][number];

describe('buildAIDraftKey', () => {
  it('scopes by workspace, user and conversation', () => {
    expect(KEY).toBe('xyne-ai-draft:ws1:u1:conv1');
    expect(buildAIDraftKey('ws1', 'u2', 'conv1')).not.toBe(KEY);
  });

  it('is null without a user, workspace or scope', () => {
    expect(buildAIDraftKey(undefined, 'u1', 'new')).toBeNull();
    expect(buildAIDraftKey('ws1', null, 'new')).toBeNull();
    expect(buildAIDraftKey('ws1', 'u1', '')).toBeNull();
  });
});

describe('write / read', () => {
  it('round-trips text and context', () => {
    const storage = memoryStorage();
    const context = toDraftContext({ ...EMPTY_COMPOSER_CONTEXT, channels: [channel] });
    writeAIDraft(storage, KEY, { text: 'hello', context, agentSlug: 'xyne' }, { now: 1000 });
    const draft = readAIDraft(storage, KEY, 2000);
    expect(draft?.text).toBe('hello');
    expect(draft?.context?.channels).toEqual([channel]);
    expect(draft?.agentSlug).toBe('xyne');
  });

  it('removes the stored draft when written empty (a genuine clear)', () => {
    const storage = memoryStorage();
    writeAIDraft(storage, KEY, { text: 'hello' });
    writeAIDraft(storage, KEY, { text: '   ' });
    expect(storage.map.size).toBe(0);
  });

  it('keeps a context-only draft (chips picked, nothing typed)', () => {
    const storage = memoryStorage();
    const context = toDraftContext({ ...EMPTY_COMPOSER_CONTEXT, channels: [channel] });
    writeAIDraft(storage, KEY, { text: '', context });
    expect(readAIDraft(storage, KEY)?.context?.channels).toHaveLength(1);
  });

  it('does not treat toggles or a model pin alone as a draft', () => {
    const context = toDraftContext({
      ...EMPTY_COMPOSER_CONTEXT,
      webSearchEnabled: true,
      model: 'gpt',
    });
    expect(isDraftEmpty({ text: '', context })).toBe(true);
  });

  it('keeps existing context on a text-only write', () => {
    const storage = memoryStorage();
    const context = toDraftContext({ ...EMPTY_COMPOSER_CONTEXT, channels: [channel] });
    writeAIDraft(storage, KEY, { text: 'from /ai', context, agentSlug: 'a' });
    writeAIDraft(storage, KEY, { text: 'edited in sidebar' }, { keepExistingContext: true });
    const draft = readAIDraft(storage, KEY);
    expect(draft?.text).toBe('edited in sidebar');
    expect(draft?.context?.channels).toEqual([channel]);
    expect(draft?.agentSlug).toBe('a');
  });

  it('expires drafts after the TTL', () => {
    const storage = memoryStorage();
    writeAIDraft(storage, KEY, { text: 'old' }, { now: 0 });
    expect(readAIDraft(storage, KEY, AI_DRAFT_TTL_MS + 1)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it('ignores corrupt entries', () => {
    const storage = memoryStorage();
    storage.setItem(KEY!, '{not json');
    expect(readAIDraft(storage, KEY)).toBeNull();
    storage.setItem(KEY!, JSON.stringify({ v: 2, text: 'x', savedAt: 1 }));
    expect(readAIDraft(storage, KEY)).toBeNull();
  });

  it('caps very long text', () => {
    const storage = memoryStorage();
    writeAIDraft(storage, KEY, { text: 'a'.repeat(AI_DRAFT_MAX_TEXT + 10) });
    expect(readAIDraft(storage, KEY)?.text).toHaveLength(AI_DRAFT_MAX_TEXT);
  });

  it('reports a refused write instead of throwing', () => {
    const storage = memoryStorage();
    storage.setItem = (): void => {
      throw new Error('QuotaExceededError');
    };
    expect(writeAIDraft(storage, KEY, { text: 'x' })).toBe(false);
  });

  it('is a no-op without storage or a key', () => {
    expect(writeAIDraft(null, KEY, { text: 'x' })).toBe(false);
    expect(writeAIDraft(memoryStorage(), null, { text: 'x' })).toBe(false);
    expect(readAIDraft(null, KEY)).toBeNull();
  });
});

describe('pruneAIDrafts', () => {
  it('drops expired and corrupt drafts and leaves other keys alone', () => {
    const storage = memoryStorage();
    writeAIDraft(storage, buildAIDraftKey('ws', 'u', 'old'), { text: 'old' }, { now: 0 });
    writeAIDraft(
      storage,
      buildAIDraftKey('ws', 'u', 'fresh'),
      { text: 'fresh' },
      { now: AI_DRAFT_TTL_MS },
    );
    storage.setItem('xyne-ai-draft:ws:u:bad', 'nope');
    storage.setItem('unrelated', 'keep');
    pruneAIDrafts(storage, AI_DRAFT_TTL_MS + 10);
    expect([...storage.map.keys()].sort()).toEqual(['unrelated', 'xyne-ai-draft:ws:u:fresh']);
  });
});

describe('applyDraftContext', () => {
  const base = { ...EMPTY_COMPOSER_CONTEXT, webSearchEnabled: true };
  const context = toDraftContext({
    ...EMPTY_COMPOSER_CONTEXT,
    channels: [channel],
    model: 'pinned',
    modelProvider: 'litellm',
    thinkingLevel: 'high',
    webSearchEnabled: false,
  });

  it('restores picked context and toggles', () => {
    const next = applyDraftContext(
      base,
      { v: 1, text: '', context, agentSlug: 'a', savedAt: 0 },
      'a',
    );
    expect(next.channels).toEqual([channel]);
    expect(next.webSearchEnabled).toBe(false);
  });

  it('restores the model pin only for the same agent', () => {
    const draft = { v: 1 as const, text: '', context, agentSlug: 'a', savedAt: 0 };
    expect(applyDraftContext(base, draft, 'a').model).toBe('pinned');
    const other = applyDraftContext(base, draft, 'b');
    expect(other.model).toBeNull();
    expect(other.thinkingLevel).toBeNull();
  });

  it('leaves the base untouched for a text-only draft', () => {
    expect(applyDraftContext(base, { v: 1, text: 'x', savedAt: 0 }, null)).toBe(base);
  });
});
