import { ACTIONS, type ChannelRef, type PersonRef } from '@xyne/shared/assistant';
import { toFieldUpdates } from './fieldUpdates';
import type { RecordFinder } from './records';

describe('message search field updates', () => {
  it('replaces a previous channel filter and retains earlier people filters', async () => {
    const android: ChannelRef = { kind: 'channel', id: 'c-android', name: 'android' };
    const ios: ChannelRef = { kind: 'channel', id: 'c-ios', name: 'ios' };
    const priya: PersonRef = { kind: 'person', id: 'u-priya', name: 'Priya Shah' };
    const meera: PersonRef = { kind: 'person', id: 'u-meera', name: 'Meera Mehta' };
    let threadHints: { people: string[]; channels: string[] } | undefined;
    const finder: RecordFinder = {
      selfId: 'u-current',
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

  it('includes the current user only when the search says they took part', async () => {
    const meera: PersonRef = { kind: 'person', id: 'u-meera', name: 'Meera Mehta' };
    const seen: Array<{ people: string[]; channels: string[] }> = [];
    const finder: RecordFinder = {
      selfId: 'u-current',
      async find(kind, _mention, hints) {
        if (kind === 'person') return [{ record: meera }];
        if (kind === 'thread') seen.push(hints ?? { people: [], channels: [] });
        if (kind === 'channel') {
          return [{ record: { kind: 'channel', id: 'c-android', name: 'android' } }];
        }
        return [];
      },
      async get() {
        return null;
      },
    };
    const action = ACTIONS.get('find_conversation');
    if (!action) throw new Error('find_conversation action is missing');

    const firstUpdates = await toFieldUpdates(
      action,
      { conversation: 'mobile performance', with: 'Meera' },
      finder,
      true,
      {},
      'Find the thread where me and Meera discussed mobile performance'
    );
    const persistedPeople = firstUpdates
      .flatMap((update) =>
        update.field === 'with' && update.op === 'add' ? [update.value] : []
      );

    await toFieldUpdates(
      action,
      { conversation: 'mobile performance', in: 'Android' },
      finder,
      true,
      { with: persistedPeople },
      'Only in Android'
    );

    await toFieldUpdates(
      action,
      { conversation: 'mobile performance', with: 'Meera' },
      finder,
      true,
      {},
      'Find me a thread about mobile performance with Meera'
    );

    expect(persistedPeople).toEqual([
      { kind: 'person', id: 'u-current', name: 'you' },
      meera,
    ]);
    expect(seen).toEqual([
      { people: ['u-current', 'u-meera'], channels: [] },
      { people: ['u-current', 'u-meera'], channels: ['c-android'] },
      { people: ['u-meera'], channels: [] },
    ]);
  });

  it('defers message search while a requested participant is unresolved', async () => {
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
      true,
    );

    expect(threadSearches).toBe(0);
    expect(updates).toEqual([
      { field: 'with', op: 'unknown', mention: 'Unknown Person' },
      { field: 'conversation', op: 'defer', mention: 'offline sync' },
    ]);
  });
});
