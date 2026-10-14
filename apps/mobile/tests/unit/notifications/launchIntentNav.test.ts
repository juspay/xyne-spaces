import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { launchIntentExtrasToNavData } from '@/src/notifications/launchIntentNav';
import { extractMessageContext } from '@/src/notifications/message/messageContext';

describe('launchIntentExtrasToNavData', () => {
  it('returns null for missing extras and call launches', () => {
    assert.equal(launchIntentExtrasToNavData(null), null);
    assert.equal(launchIntentExtrasToNavData({}), null);
    assert.equal(
      launchIntentExtrasToNavData({
        callId: 'call-1',
        type: 'DIRECT_MESSAGE',
        channelId: 'c1',
      }),
      null,
    );
  });

  it('keeps a Notifee tray payload so recoverInitialTap can open chat', () => {
    const data = launchIntentExtrasToNavData({
      _v4: 'true',
      type: 'DIRECT_MESSAGE',
      channelId: 'cmlj3q1i4027i6sa3u7h96lyk',
      messageId: 'cmt73vgs5003dwde30mjmaqjm',
      notificationId: 'cmlj3q1i4027i6sa3u7h96lyk',
      scopeType: 'DM',
    });

    assert.ok(data);
    const message = extractMessageContext(data);
    assert.ok(message);
    assert.equal(message.channelId, 'cmlj3q1i4027i6sa3u7h96lyk');
    assert.equal(message.messageId, 'cmt73vgs5003dwde30mjmaqjm');
  });

  it('merges a JSON data blob from nested extras', () => {
    const data = launchIntentExtrasToNavData({
      data: JSON.stringify({
        type: 'DIRECT_MESSAGE',
        channelId: 'channel-json',
        messageId: 'msg-json',
        _v4: 'true',
      }),
    });

    assert.ok(data);
    const message = extractMessageContext(data);
    assert.ok(message);
    assert.equal(message.channelId, 'channel-json');
    assert.equal(message.messageId, 'msg-json');
  });

  it('flattens nested Expo data wrappers used on Android tray taps', () => {
    const data = launchIntentExtrasToNavData({
      experienceId: '@xyne/spaces',
      data: {
        type: 'TICKET_STATUS_CHANGE',
        notificationId: 'notif-status-1',
        metadata: JSON.stringify({
          ticketId: 'ticket-nested',
          channelId: 'channel-nested',
        }),
      },
    });

    assert.ok(data);
    assert.equal(data['type'], 'TICKET_STATUS_CHANGE');
    assert.equal(data['notificationId'], 'notif-status-1');
    assert.match(data['metadata'] ?? '', /ticket-nested/);
  });

  it('flattens a JSON-string data wrapper used on Android tray taps', () => {
    const data = launchIntentExtrasToNavData({
      experienceId: '@xyne/spaces',
      data: JSON.stringify({
        type: 'TICKET_STATUS_CHANGE',
        notificationId: 'notif-status-1',
        metadata: JSON.stringify({
          ticketId: 'ticket-nested',
          channelId: 'channel-nested',
        }),
      }),
    });

    assert.ok(data);
    assert.equal(data['type'], 'TICKET_STATUS_CHANGE');
    assert.equal(data['notificationId'], 'notif-status-1');
    assert.match(data['metadata'] ?? '', /ticket-nested/);
  });

  it('does not treat a user-authored body as routing data', () => {
    const data = launchIntentExtrasToNavData({
      type: 'TICKET_PRIORITY_CHANGED',
      body: JSON.stringify({
        type: 'DIRECT_MESSAGE',
        channelId: 'from-body',
        metadata: JSON.stringify({ ticketId: 'from-body' }),
      }),
      metadata: JSON.stringify({ ticketId: 'ticket-1' }),
    });

    assert.ok(data);
    assert.equal(data['type'], 'TICKET_PRIORITY_CHANGED');
    assert.equal(data['channelId'], undefined);
  });

  it('keeps a standalone ticket payload so recoverInitialTap can open the ticket', () => {
    const data = launchIntentExtrasToNavData({
      type: 'TICKET_PRIORITY_CHANGED',
      metadata: JSON.stringify({
        ticketId: 'ticket-1',
        channelId: 'channel-1',
        conversationId: 'conv-1',
      }),
    });

    assert.ok(data);
    assert.equal(data['type'], 'TICKET_PRIORITY_CHANGED');
    assert.equal(extractMessageContext(data), null);
  });
});
