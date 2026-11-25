import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bubblesShowOver } from '@/src/features/conversation/model/bubbles';
import { activityTargetOpensThread } from '@/src/features/conversation/thread-card-source';
import { roomBeneathCard } from '@/src/features/conversation/model/room-beneath';
import {
  CHAT_THREAD_ROUTE,
  THREAD_CARD_ROUTE,
  setThreadCardRoute,
  threadRoutePathname,
} from '@/src/features/conversation/thread-route';

describe('roomBeneathCard', () => {
  const card = { key: 'card', name: 'thread/[channelId]/[threadId]' };

  it('finds the room in front of the chat stack under the root card', () => {
    const state = {
      routes: [
        { key: 'tabs', name: '(spaces)' },
        {
          key: 'chat',
          name: 'chat',
          state: {
            index: 0,
            routes: [{ key: 'room', name: '[channelId]/index', params: { channelId: 'c1' } }],
          },
        },
        card,
      ],
    };
    assert.equal(roomBeneathCard(state, 'card'), 'c1');
  });

  it('reads the room a freshly pushed chat stack was opened with', () => {
    const state = {
      routes: [
        { key: 'tabs', name: '(spaces)' },
        {
          key: 'chat',
          name: 'chat',
          params: {
            channelId: 'c1',
            screen: '[channelId]/index',
            params: { channelId: 'c1', surface: 'channels' },
          },
        },
        card,
      ],
    };
    assert.equal(roomBeneathCard(state, 'card'), 'c1');
  });

  it('follows the navigator to the screen in front, not the first one', () => {
    const state = {
      routes: [
        {
          key: 'chat',
          name: 'chat',
          state: {
            index: 1,
            routes: [
              { key: 'a', name: '[channelId]/index', params: { channelId: 'c1' } },
              { key: 'b', name: '[channelId]/info', params: { channelId: 'c1' } },
            ],
          },
        },
        card,
      ],
    };
    assert.equal(roomBeneathCard(state, 'card'), null);
  });

  it('is null over Activity, Search or anything that is not a room', () => {
    const state = {
      routes: [
        { key: 'tabs', name: '(spaces)', state: { routes: [{ key: 'x', name: 'activity' }] } },
        card,
      ],
    };
    assert.equal(roomBeneathCard(state, 'card'), null);
  });

  it('reads a room directly beneath in the same stack (the chat-stack card)', () => {
    const state = {
      routes: [{ key: 'room', name: '[channelId]', params: { channelId: 'c2' } }, card],
    };
    assert.equal(roomBeneathCard(state, 'card'), 'c2');
  });

  it('is null when the card is first or missing', () => {
    assert.equal(roomBeneathCard({ routes: [card] }, 'card'), null);
    assert.equal(roomBeneathCard({ routes: [] }, 'card'), null);
  });
});

describe('bubblesShowOver', () => {
  it('floats over tabs and rooms', () => {
    assert.equal(bubblesShowOver(['(protected)', '(spaces)', 'activity']), true);
    assert.equal(bubblesShowOver(['(protected)', 'chat', '[channelId]']), true);
  });

  it('hides under a thread, a call and full-screen viewers', () => {
    assert.equal(bubblesShowOver(['(protected)', 'thread', '[channelId]', '[threadId]']), false);
    assert.equal(bubblesShowOver(['(protected)', 'chat', '[channelId]', '[threadId]']), false);
    assert.equal(bubblesShowOver(['(protected)', 'native-call']), false);
    assert.equal(bubblesShowOver(['(protected)', 'attachments-viewer']), false);
  });

  it('hides over call webviews, recordings and canvases', () => {
    assert.equal(bubblesShowOver(['(protected)', 'call', '[callId]']), false);
    assert.equal(bubblesShowOver(['(protected)', 'recording', '[recordingId]']), false);
    assert.equal(bubblesShowOver(['(protected)', 'canvas']), false);
    assert.equal(bubblesShowOver(['(protected)', 'channel-canvas']), false);
  });

  it('hides over a ticket only while it shows a parked thread', () => {
    const ticket = ['(protected)', 'tickets', '[ticketId]'];
    assert.equal(bubblesShowOver(ticket, 't1', ['t1']), false);
    assert.equal(bubblesShowOver(ticket, 't2', ['t1']), true);
    assert.equal(bubblesShowOver(ticket), true);
  });
});

describe('activityTargetOpensThread', () => {
  it('grows the card only out of rows that open a thread', () => {
    assert.equal(activityTargetOpensThread({ kind: 'message', isThreadReply: true }), true);
    assert.equal(activityTargetOpensThread({ kind: 'message', isThreadReply: false }), false);
    assert.equal(activityTargetOpensThread({ kind: 'channel' }), false);
  });
});

describe('threadRoutePathname', () => {
  it('opens the chat-stack thread until the shell turns the card on', () => {
    setThreadCardRoute(false);
    assert.equal(threadRoutePathname(), CHAT_THREAD_ROUTE);
    setThreadCardRoute(true);
    assert.equal(threadRoutePathname(), THREAD_CARD_ROUTE);
    setThreadCardRoute(false);
  });
});
