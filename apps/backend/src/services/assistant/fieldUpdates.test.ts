import { ACTIONS, type ChannelRef, type PersonRef } from '@xyne/shared/assistant';
import { toFieldUpdates } from './fieldUpdates';
import type { FoundRecord, RecordFinder, SearchHints } from './records';

describe('message search field updates', () => {
  it('replaces a previous channel filter and retains earlier people filters', async () => {
    const android: ChannelRef = { kind: 'channel', id: 'c-android', name: 'android' };
    const ios: ChannelRef = { kind: 'channel', id: 'c-ios', name: 'ios' };
    const priya: PersonRef = { kind: 'person', id: 'u-priya', name: 'Priya Shah' };
    const meera: PersonRef = { kind: 'person', id: 'u-meera', name: 'Meera Mehta' };
    let threadHints: { people: string[]; channels: string[] } | undefined;
    const finder: RecordFinder = {
      async find(kind, mention, hints) {
        if (kind === 'channel') {
          return [mention === 'Android' ? android : ios].map((record) => ({ record }));
        }
        if (kind === 'person') return [{ record: meera }];
        threadHints = hints;
        return [];
      },
      async get() {
        return null;
      },
    };
    const action = ACTIONS.get('find_conversation');
    if (!action) throw new Error('find_conversation action is missing');

    await toFieldUpdates(
      action,
      { conversation: 'release notes', with: 'Meera', in: 'Android' },
      finder,
      true,
      { with: [priya], in: ios }
    );

    expect(threadHints).toEqual({ people: ['u-priya', 'u-meera'], channels: ['c-android'] });
  });

  it('holds a message search until the person it is narrowed by is settled', async () => {
    let threadSearches = 0;
    const finder: RecordFinder = {
      async find(kind) {
        if (kind === 'thread') threadSearches += 1;
        return [];
      },
      async get() {
        return null;
      },
    };
    const action = ACTIONS.get('find_conversation');
    if (!action) throw new Error('find_conversation action is missing');

    const updates = await toFieldUpdates(
      action,
      { conversation: 'offline sync', with: 'Unknown Person' },
      finder,
      true
    );

    expect(threadSearches).toBe(0);
    expect(updates).toEqual([
      { field: 'with', op: 'open', said: 'Unknown Person', options: [] },
      { field: 'conversation', op: 'later', said: 'offline sync' },
    ]);
  });

  it('does not mistake a channel phrase for an unresolved participant', async () => {
    const ios: ChannelRef = { kind: 'channel', id: 'c-ios', name: 'ios' };
    const iosThread: FoundRecord = {
      record: {
        kind: 'thread',
        id: 't-login-ios',
        name: 'Login errors on the new build',
        channelId: ios.id,
        channelName: ios.name,
      },
    };
    let threadSearch: { topic: string; hints?: SearchHints } | undefined;
    const finder: RecordFinder = {
      async find(kind, mention, hints) {
        if (kind === 'channel') return [{ record: ios }];
        if (kind === 'thread') {
          threadSearch = { topic: mention, hints };
          return [iosThread];
        }
        return [];
      },
      async get() {
        return null;
      },
    };
    const action = ACTIONS.get('find_conversation');
    if (!action) throw new Error('find_conversation action is missing');

    const updates = await toFieldUpdates(
      action,
      {
        conversation: 'login errors',
        with: 'the one in the ios channel',
        in: 'ios',
      },
      finder,
      true
    );

    expect(threadSearch).toEqual({
      topic: 'login errors',
      hints: { people: [], channels: [ios.id] },
    });
    expect(updates).toEqual([
      { field: 'in', op: 'set', value: ios, certain: true },
      { field: 'conversation', op: 'set', value: iosThread.record, certain: false },
    ]);
  });

  it('does not use an @mentioned agent to filter the thread being replied to', async () => {
    const bot: PersonRef = { kind: 'person', id: 'u-build-bot', name: 'Build Bot' };
    let threadHints: SearchHints | undefined;
    const finder: RecordFinder = {
      async find(kind, _mention, hints) {
        if (kind === 'person') return [{ record: bot }];
        if (kind === 'thread') threadHints = hints;
        return [];
      },
      async get() {
        return null;
      },
    };
    const action = ACTIONS.get('reply_in_thread');
    if (!action) throw new Error('reply_in_thread action is missing');

    await toFieldUpdates(
      action,
      { thread: 'release notes', mentions: 'Build Bot', message: 'review this message' },
      finder,
      true
    );

    expect(threadHints).toEqual({ people: [], channels: [] });
  });
});
