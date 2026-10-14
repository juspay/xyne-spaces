import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { containsChatWindowTarget } from '@/src/features/chat/navigation/chatWindowContainment';

import { deriveDataFacts } from '../data/deriveDataFacts';
import { EMPTY_WINDOW } from '../data/normalizeConversationWindow';
import type { OpenIntent } from '../intent/openIntent.types';
import { openReducer } from '../machine/openReducer';
import { EMPTY_FACTS } from '../machine/openState';
import { isSkeletonVisible } from '../machine/selectors';
import { isAuthoritativeFor } from '../warm/isAuthoritativeFor';
import { readWarmWindow, warmWindowAction, type ReadWarmWindowDeps } from '../warm/readWarmWindow';
import {
  hydratePersistedWindowWith,
  persistedTargetForRestore,
  restoreIntentFromLastOpen,
} from '../warm/restoreIntent';
import {
  EXPECTED_CHAT_CACHE_ENTITY_VERSION,
  decodeWarmEntity,
  isWarmSchemaCompatible,
} from '../warm/schemaGuard';
import { WARM_CACHE_CAPS, type WarmWindow } from '../warm/warmWindow.types';

const compatibleSchema = {
  storedSchemaVersion: 'v1',
  expectedSchemaVersion: 'v1',
  storedEntityVersion: EXPECTED_CHAT_CACHE_ENTITY_VERSION,
  expectedEntityVersion: EXPECTED_CHAT_CACHE_ENTITY_VERSION,
};

const intent = (over: Partial<OpenIntent> = {}): OpenIntent => ({
  intentKey: 'channel:ch-1',
  surface: { kind: 'channel', channelId: 'ch-1' },
  entry: 'notification',
  isColdStart: true,
  raw: {},
  hint: { channelId: 'ch-1' },
  ...over,
});

const channelRows = [
  { conversationId: 'c1', initialMessageId: 'm1', createdAt: 10, initialMessageMd: 'one' },
  { conversationId: 'c2', initialMessageId: 'm2', createdAt: 20, initialMessageMd: 'two' },
];

const deps = (over: Partial<ReadWarmWindowDeps> = {}): ReadWarmWindowDeps => ({
  readEntity: (): unknown | null => channelRows,
  containsTarget: containsChatWindowTarget,
  schema: compatibleSchema,
  now: (): number => 50,
  ...over,
});

const warm = (over: Partial<WarmWindow> = {}): WarmWindow => ({
  kind: 'channel',
  id: 'ch-1',
  rows: channelRows,
  records: channelRows,
  fingerprint: 'c1,c2',
  readAt: 50,
  containsTarget: true,
  ...over,
});

describe('schemaGuard', (): void => {
  it('treats a schema or entity-version mismatch as no warm window', (): void => {
    assert.equal(isWarmSchemaCompatible(compatibleSchema), true);
    assert.equal(
      isWarmSchemaCompatible({ ...compatibleSchema, storedSchemaVersion: 'old' }),
      false,
    );
    assert.equal(isWarmSchemaCompatible({ ...compatibleSchema, storedEntityVersion: '0' }), false);
    assert.equal(isWarmSchemaCompatible({ ...compatibleSchema, storedSchemaVersion: null }), false);
  });

  it('treats a corrupted cache entry as null, not a partial read', (): void => {
    assert.equal(decodeWarmEntity('{not-json'), null);
    assert.equal(decodeWarmEntity(''), null);
    assert.equal(decodeWarmEntity(null), null);
    assert.deepEqual(decodeWarmEntity('{"messages":[]}'), { messages: [] });
  });
});

describe('readWarmWindow', (): void => {
  it('returns a containing window from the injected reader', (): void => {
    const window = readWarmWindow(intent({ hint: { channelId: 'ch-1', messageId: 'm1' } }), deps());
    assert.ok(window);
    assert.equal(window.kind, 'channel');
    assert.equal(window.id, 'ch-1');
    assert.equal(window.containsTarget, true);
    assert.equal(window.rows.length, 2);
    assert.equal(window.records.length, 2);
    assert.equal(window.fingerprint, 'c1,c2');
    assert.equal(window.readAt, 50);
  });

  it('uses shared containment and does not re-implement it', (): void => {
    const source = readFileSync(
      fileURLToPath(new URL('../warm/readWarmWindow.ts', import.meta.url)),
      'utf8',
    );
    assert.equal(/containsTarget/.test(source), true);
    assert.equal(/initialMessageId === messageId/.test(source), false);
    const miss = readWarmWindow(intent({ hint: { channelId: 'ch-1', messageId: 'nope' } }), deps());
    assert.equal(miss?.containsTarget, false);
  });

  it('returns null on a schema mismatch, empty entity, or missing cache', (): void => {
    assert.equal(
      readWarmWindow(intent(), deps({ schema: { ...compatibleSchema, storedEntityVersion: '9' } })),
      null,
    );
    assert.equal(readWarmWindow(intent(), deps({ readEntity: (): null => null })), null);
    assert.equal(readWarmWindow(intent(), deps({ readEntity: (): unknown => [] })), null);
  });

  it('reads a thread entity from messages[]', (): void => {
    const window = readWarmWindow(
      intent({
        intentKey: 'thread:ch-1:th-1',
        surface: { kind: 'thread', channelId: 'ch-1', threadId: 'th-1' },
        hint: { channelId: 'ch-1', threadId: 'th-1', messageId: 'm9' },
      }),
      deps({
        readEntity: (): unknown => ({
          messages: [{ conversationId: 'th-1', messageId: 'm9', createdAt: 1 }],
        }),
      }),
    );
    assert.ok(window);
    assert.equal(window.kind, 'thread');
    assert.equal(window.containsTarget, true);
  });
});

describe('isAuthoritativeFor (I8)', (): void => {
  it('a partial live window cannot evict a warm window holding the target', (): void => {
    const target = {
      kind: 'anchor' as const,
      conversationId: 'c1',
      messageId: 'm1',
      createdAt: 10,
    };
    assert.equal(
      isAuthoritativeFor({ rows: [{ conversationId: 'c1' }], isSettled: false }, warm(), target),
      false,
    );
  });

  it('a settled live window that can land the target does take over', (): void => {
    const target = {
      kind: 'anchor' as const,
      conversationId: 'c1',
      messageId: 'm1',
      createdAt: 10,
    };
    assert.equal(
      isAuthoritativeFor(
        { rows: [{ conversationId: 'c1', initialMessageId: 'm1' }], isSettled: true },
        warm(),
        target,
      ),
      true,
    );
    assert.equal(
      isAuthoritativeFor({ rows: [{ conversationId: 'other' }], isSettled: true }, warm(), target),
      false,
    );
  });
});

describe('warm window → machine', (): void => {
  it('a containing warm window skips loading after the location is resolved', (): void => {
    const window = readWarmWindow(intent({ hint: { channelId: 'ch-1', messageId: 'm1' } }), deps());
    const resolved = openReducer(
      { status: 'resolving', intent: intent(), startedAt: 0 },
      {
        type: 'surfaceResolved',
        location: {
          surface: { kind: 'channel', channelId: 'ch-1' },
          anchor: { conversationId: 'c1', messageId: 'm1', createdAt: 10 },
          unreadBoundary: null,
        },
        now: 4,
        intentKey: 'channel:ch-1',
      },
    );
    const next = openReducer(resolved, warmWindowAction(intent(), window, 5));
    assert.equal(next.status, 'placing');
    if (next.status === 'placing') {
      assert.equal(next.source, 'warm');
    }
  });

  it('no warm data stays on skeleton until the live query settles', (): void => {
    const resolving = { status: 'resolving' as const, intent: intent(), startedAt: 0 };
    const loading = openReducer(resolving, {
      type: 'surfaceResolved',
      location: {
        surface: { kind: 'channel', channelId: 'ch-1' },
        anchor: null,
        unreadBoundary: null,
      },
      now: 4,
      intentKey: 'channel:ch-1',
    });
    assert.equal(loading.status, 'loading');
    assert.equal(isSkeletonVisible(loading, EMPTY_FACTS), true);
    const stillWaiting = openReducer(loading, {
      type: 'tick',
      now: 60_000,
      intentKey: 'channel:ch-1',
    });
    assert.equal(stillWaiting.status, 'loading');
    assert.equal(isSkeletonVisible(stillWaiting, EMPTY_FACTS), true);
  });
});

describe('deriveDataFacts warm handover', (): void => {
  it('keeps warm facts until the live window is authoritative', (): void => {
    const target = {
      kind: 'anchor' as const,
      conversationId: 'c1',
      messageId: 'm1',
      createdAt: 10,
    };
    const seeded = deriveDataFacts(EMPTY_WINDOW, target, warm());
    assert.equal(seeded.hasWarmWindow, true);
    assert.equal(seeded.warmContainsTarget, true);
    assert.equal(seeded.hasPaintableRows, true);
    assert.equal(seeded.liveIsAuthoritative, false);

    const settled = deriveDataFacts(
      {
        conversations: [{ conversationId: 'c1', initialMessageId: 'm1' }],
        isInitialLoadComplete: true,
        hasReachedStart: true,
      },
      target,
      warm(),
    );
    assert.equal(settled.liveIsAuthoritative, true);
  });
});

describe('restore + lastOpenChannel semantics', (): void => {
  it('builds an OpenIntent with entry restore from a last-open channel id', (): void => {
    const result = restoreIntentFromLastOpen('ch-9');
    assert.equal(result.ok, true);
    if (!result.ok) {
      throw new Error('expected ok');
    }
    assert.equal(result.value.entry, 'restore');
    assert.equal(result.value.isColdStart, true);
    assert.equal(result.value.surface.kind, 'channel');
    assert.equal(result.value.intentKey, 'channel:ch-9');
    assert.equal(restoreIntentFromLastOpen(null).ok, false);
  });

  it('maps a restore target onto the shared persisted-window shape', (): void => {
    assert.deepEqual(persistedTargetForRestore('ch-1', { messageId: 'm1' }), {
      channelId: 'ch-1',
      kind: 'channel',
      messageId: 'm1',
    });
  });

  it('hydrates the persisted window from the intent surface before live subscribe', (): void => {
    const restored: unknown[] = [];
    hydratePersistedWindowWith(
      intent({
        surface: { kind: 'thread', channelId: 'ch-1', threadId: 'th-9' },
        hint: { channelId: 'ch-1', threadId: 'th-9', messageId: 'm-9' },
      }),
      (target): void => {
        restored.push(target);
      },
    );
    assert.deepEqual(restored, [
      {
        channelId: 'ch-1',
        kind: 'thread',
        threadId: 'th-9',
        messageId: 'm-9',
      },
    ]);
  });

  it('consumes lastOpenChannel and restorePersistedChatWindow read-only', (): void => {
    const lastOpen = readFileSync(
      fileURLToPath(new URL('../../lastOpenChannel.ts', import.meta.url)),
      'utf8',
    );
    const restore = readFileSync(
      fileURLToPath(new URL('../../navigation/restorePersistedChatWindow.ts', import.meta.url)),
      'utf8',
    );
    const warmDir = readFileSync(
      fileURLToPath(new URL('../warm/restoreIntent.ts', import.meta.url)),
      'utf8',
    );
    assert.equal(/version: 1/.test(lastOpen), true);
    assert.equal(/scrollOffset|contentOffset|readPosition/.test(lastOpen), false);
    assert.equal(/containsChatWindowTarget/.test(restore), true);
    assert.equal(/features\/chat\/v2/.test(warmDir), false);
    assert.equal(/rememberLastOpenChannel/.test(warmDir), false);
  });
});

describe('warm cache caps', (): void => {
  it('match the adapter LRU caps and are not changed in the v3 read path', (): void => {
    const adapter = readFileSync(
      fileURLToPath(new URL('../../../../services/mmkvStorageAdapter.ts', import.meta.url)),
      'utf8',
    );
    assert.equal(WARM_CACHE_CAPS.maxDiskChannels, 100);
    assert.equal(WARM_CACHE_CAPS.maxDiskThreads, 50);
    assert.equal(WARM_CACHE_CAPS.maxDiskChannelRows, 200);
    assert.equal(/MAX_DISK_CHANNELS = 100/.test(adapter), true);
    assert.equal(/MAX_DISK_THREADS = 50/.test(adapter), true);
    assert.equal(/MAX_DISK_CHANNEL_ROWS = 200/.test(adapter), true);
  });
});
