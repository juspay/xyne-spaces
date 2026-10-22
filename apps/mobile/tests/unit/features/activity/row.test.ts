import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildActivityRow,
  buildActivityRows,
  type ActivityRowContext,
  type ActivityRowData,
} from '@/src/features/activity/model/row';
import type { ActivityWithRelated } from '@/src/types/activity';

const channel = { id: 'c1', name: 'payments-core', scopeType: 'DEFAULT' };

const users = [
  { id: 'u1', name: 'Priya Raghavan' },
  { id: 'me', name: 'Daksh' },
];

const ctx = {
  currentUserId: 'me',
  users,
  usersById: new Map(users.map(user => [user.id, user])),
  channelsById: new Map([[channel.id, channel]]),
  channelLabel: (c: { name: string }) => c.name,
  // The real resolver lives with the router; here the target is just the
  // message the activity carries.
  navigationTarget: (a: ActivityWithRelated) =>
    a.message
      ? ({
          kind: 'message',
          channelId: a.message.conversation!.channelId,
          conversationId: a.message.conversation!.conversationId,
          messageId: a.message.messageId,
          isThreadReply: false,
          conversationCreatedAt: 1,
        } as const)
      : ({ kind: 'none' } as const),
} as unknown as ActivityRowContext;

function activity(overrides: Record<string, unknown> = {}): ActivityWithRelated {
  return {
    id: 'a1',
    userId: 'me',
    actorId: 'u1',
    actorAction: 'mentioned_user',
    isRead: false,
    createdAt: 1_000,
    updatedAt: 2_000,
    channelId: 'c1',
    message: {
      messageId: 'm1',
      senderId: 'u1',
      content: '<p>hi</p>',
      conversation: { channelId: 'c1', conversationId: 'v1', initialMessageId: 'm0', createdAt: 1 },
    },
    ...overrides,
  } as unknown as ActivityWithRelated;
}

describe('buildActivityRow', () => {
  it('describes a mention with the actor, channel and message', () => {
    const row = buildActivityRow(activity(), ctx);
    assert.ok(row);
    assert.equal(row.id, 'a1');
    assert.equal(row.isUnread, true);
    assert.equal(row.actorName, 'Priya Raghavan');
    assert.equal(row.badge, 'mention');
    assert.equal(row.timeMs, 2_000);
    assert.deepEqual(row.subject, { kind: 'channel', label: 'payments-core' });
    assert.deepEqual(row.body, {
      kind: 'message',
      content: '<p>hi</p>',
      senderId: 'u1',
      conversationId: 'v1',
      attachments: [],
    });
    assert.equal(row.target.kind, 'message');
  });

  it('carries the message attachments, and no more than the grid needs', () => {
    const row = buildActivityRow(
      activity({
        message: {
          messageId: 'm1',
          senderId: 'u1',
          content: '',
          conversation: { channelId: 'c1', conversationId: 'v1' },
          attachments: [
            {
              id: 'f1',
              mimetype: 'image/png',
              originalFilename: 'a.png',
              size: 10,
              metadata: null,
            },
            { id: 'f2', mimetype: null, originalFilename: null, size: null, metadata: null },
          ],
        },
      }),
      ctx,
    );
    assert.ok(row);
    assert.equal(row.body.kind, 'message');
    if (row.body.kind !== 'message') return;
    assert.deepEqual(row.body.attachments, [
      { id: 'f1', mimetype: 'image/png', originalFilename: 'a.png', size: 10 },
      { id: 'f2', mimetype: 'application/octet-stream' },
    ]);
  });

  it('marks read activities as not unread', () => {
    assert.equal(buildActivityRow(activity({ isRead: true }), ctx)?.isUnread, false);
  });

  it('drops an activity whose message has not synced', () => {
    assert.equal(buildActivityRow(activity({ message: null }), ctx), null);
  });

  it('drops an action it has no describer for', () => {
    assert.equal(buildActivityRow(activity({ actorAction: 'something_new' }), ctx), null);
  });

  it('attributes system activities to Xyne and opens the ticket', () => {
    const row = buildActivityRow(
      activity({
        actorId: null,
        actorAction: 'ticket_status',
        message: null,
        ticketId: 't1',
        ticket: { id: 't1', xyneId: 'XYN-241', title: 'Fix refund', channelId: 'c1' },
      }),
      ctx,
    );
    assert.ok(row);
    assert.equal(row.actorName, 'Xyne');
    assert.equal(row.badge, 'ticket');
    assert.deepEqual(row.subject, { kind: 'ticket', label: 'XYN-241' });
    assert.deepEqual(row.target, { kind: 'ticket', ticketId: 't1', selectedTab: 'activity' });
  });

  it('sends call activities to the calls tab', () => {
    const row = buildActivityRow(activity({ actorAction: 'call_reminder', message: null }), ctx);
    assert.deepEqual(row?.target, { kind: 'calls' });
  });
});

describe('buildActivityRows', () => {
  it('reuses a row for an activity object it has already built', () => {
    const cache = new WeakMap<ActivityWithRelated, ActivityRowData | null>();
    const a = activity();
    const [first] = buildActivityRows([a], ctx, cache);
    const [second] = buildActivityRows([a], ctx, cache);
    assert.equal(second, first);
  });

  it('omits activities that produce no row', () => {
    const cache = new WeakMap<ActivityWithRelated, ActivityRowData | null>();
    const rows = buildActivityRows(
      [activity({ id: 'a1' }), activity({ id: 'a2', message: null })],
      ctx,
      cache,
    );
    assert.deepEqual(
      rows.map(row => row.id),
      ['a1'],
    );
  });
});

describe('recording summary activity', () => {
  const summaryActivity = (overrides: Record<string, unknown> = {}) =>
    activity({
      actorAction: 'recording_summary_ready',
      actionSource: 'call',
      classification: 'FYI',
      callId: 'internal-call',
      channelId: null,
      message: null,
      call: {
        id: 'internal-call',
        externalId: 'external-recording',
        callType: 'HEADLESS',
        title: 'Planning',
      },
      ...overrides,
    });

  it('renders a summary without a message or channel and opens the external recording ID', () => {
    const row = buildActivityRow(summaryActivity(), ctx);
    assert.ok(row);
    assert.equal(row.actorName, 'Recording summary');
    assert.equal(row.verb, '· "Planning"');
    assert.equal(row.badge, 'summary');
    assert.equal(row.subject, null);
    assert.deepEqual(row.body, { kind: 'text', text: 'Summary is ready to view' });
    assert.deepEqual(row.target, { kind: 'recording', recordingId: 'external-recording' });
    assert.equal(row.isUnread, true);
    assert.equal(row.timeMs, 2_000);
  });

  it('opens regular call summaries using the internal call ID', () => {
    for (const callType of ['AUDIO', 'VIDEO']) {
      const row = buildActivityRow(
        summaryActivity({
          isRead: true,
          call: { id: 'internal-call', externalId: 'external-call', callType, title: null },
        }),
        ctx,
      );
      assert.ok(row);
      assert.equal(row.actorName, 'Call summary');
      assert.equal(row.verb, '· "Untitled"');
      assert.deepEqual(row.target, { kind: 'call-detail', callId: 'internal-call' });
      assert.equal(row.isUnread, false);
    }
  });

  it('waits for the call relation and then includes the synced summary alongside existing rows', () => {
    const cache = new WeakMap<ActivityWithRelated, ActivityRowData | null>();
    const pending = summaryActivity({ call: undefined });
    assert.deepEqual(buildActivityRows([pending], ctx, cache), []);
    const rows = buildActivityRows([activity(), summaryActivity({ id: 'summary' })], ctx, cache);
    assert.deepEqual(
      rows.map(row => row.id),
      ['a1', 'summary'],
    );
    assert.equal(rows[0]?.badge, 'mention');
    assert.equal(rows[1]?.badge, 'summary');
  });

  it('does not create broken destinations for missing call IDs or recording external IDs', () => {
    assert.equal(buildActivityRow(summaryActivity({ callId: null }), ctx), null);
    assert.equal(
      buildActivityRow(
        summaryActivity({
          call: { id: 'internal-call', externalId: '', callType: 'HEADLESS' },
        }),
        ctx,
      ),
      null,
    );
  });
});
