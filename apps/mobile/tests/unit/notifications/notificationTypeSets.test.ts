import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CALL_NOTIFICATION_TYPES,
  CONTROL_NOTIFICATION_TYPES,
  MESSAGE_NOTIFICATION_TYPES,
  REMINDER_NOTIFICATION_TYPES,
  isTicketNotificationType,
} from '@/src/notifications/notificationTypeSets';

describe('notificationTypeSets', () => {
  it('classifies message notification types', () => {
    for (const t of [
      'CHANNEL_MESSAGE',
      'DIRECT_MESSAGE',
      'THREAD_REPLY',
      'THREAD_MENTION',
      'MENTION',
    ]) {
      assert.equal(MESSAGE_NOTIFICATION_TYPES.has(t), true, t);
    }
    assert.equal(MESSAGE_NOTIFICATION_TYPES.size, 5);
  });

  it('classifies call notification types', () => {
    for (const t of ['INCOMING_CALL', 'CALL_DISMISS', 'MISSED_CALL', 'ONGOING_CALL']) {
      assert.equal(CALL_NOTIFICATION_TYPES.has(t), true, t);
    }
    assert.equal(CALL_NOTIFICATION_TYPES.size, 4);
  });

  it('classifies control notification types', () => {
    for (const t of ['CHANNEL_READ', 'THREAD_READ', 'MESSAGE_DELETED', 'MESSAGE_EDITED']) {
      assert.equal(CONTROL_NOTIFICATION_TYPES.has(t), true, t);
    }
    assert.equal(CONTROL_NOTIFICATION_TYPES.size, 4);
  });

  it('classifies reminder notification types', () => {
    assert.equal(REMINDER_NOTIFICATION_TYPES.has('CALL_UPDATED'), true);
    assert.equal(REMINDER_NOTIFICATION_TYPES.size, 1);
  });

  it('keeps the four category sets mutually disjoint', () => {
    const sets = [
      MESSAGE_NOTIFICATION_TYPES,
      CALL_NOTIFICATION_TYPES,
      CONTROL_NOTIFICATION_TYPES,
      REMINDER_NOTIFICATION_TYPES,
    ];
    const all = sets.flatMap(set => [...set]);
    assert.equal(new Set(all).size, all.length);
  });

  it('does not classify an unknown type into any category', () => {
    for (const set of [
      MESSAGE_NOTIFICATION_TYPES,
      CALL_NOTIFICATION_TYPES,
      CONTROL_NOTIFICATION_TYPES,
      REMINDER_NOTIFICATION_TYPES,
    ]) {
      assert.equal(set.has('SOMETHING_ELSE'), false);
    }
  });

  it('recognizes standalone ticket notification types', () => {
    assert.equal(isTicketNotificationType('TICKET_PRIORITY_CHANGED'), true);
    assert.equal(isTicketNotificationType('TICKET_STATUS_CHANGED'), true);
    assert.equal(isTicketNotificationType('TICKET_STATUS_CHANGE'), true);
    assert.equal(isTicketNotificationType('MENTION'), false);
    assert.equal(isTicketNotificationType('CHANNEL_MESSAGE'), false);
  });
});
