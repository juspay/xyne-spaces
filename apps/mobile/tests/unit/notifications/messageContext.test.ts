import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  extractTicketRouteTarget,
  resolveTicketId,
  shouldPrefetchActivities,
} from '@/src/notifications/message/messageContext';

describe('notification ticket routing', () => {
  it('does not infer a ticket route from a chat conversation snapshot', () => {
    assert.equal(
      resolveTicketId({
        metadata: JSON.stringify({ conversation: { ticketId: 'ticket-chat' } }),
      }),
      undefined,
    );
  });

  it('accepts a related entity id only for ticket payloads', () => {
    assert.equal(
      resolveTicketId({ relatedEntityType: 'TICKET_ACTIVITY', relatedEntityId: 'ticket-1' }),
      'ticket-1',
    );
    assert.equal(resolveTicketId({ relatedEntityId: 'ticket-2' }), undefined);
  });

  it('preserves explicit ticket ids from v4 payloads', () => {
    assert.equal(resolveTicketId({ ticketId: 'ticket-explicit' }), 'ticket-explicit');
    assert.equal(
      resolveTicketId({
        metadata: JSON.stringify({
          relatedEntityType: 'TICKET',
          relatedEntityId: 'ticket-metadata',
        }),
      }),
      'ticket-metadata',
    );
  });
});

describe('extractTicketRouteTarget', () => {
  it('routes TICKET_PRIORITY_CHANGED metadata to the ticket detail screen', () => {
    const target = extractTicketRouteTarget({
      type: 'TICKET_PRIORITY_CHANGED',
      notificationId: 'cmtmrz8a905bif5w9k61ghw2l',
      metadata: JSON.stringify({
        ticketId: 'cmtmrw9dr04mwf5w9ne7i4hkg',
        actorId: 'cmkp1367t01s95dcss5vcubxx',
        channelId: 'cmoch3q8l00y511eu6vr95uhn',
        conversationId: 'cmtmrw99904muf5w9fuq9ma45',
        oldPriority: 'MEDIUM',
        newPriority: 'HIGH',
      }),
    });

    assert.deepEqual(target, {
      channelId: 'cmoch3q8l00y511eu6vr95uhn',
      ticketId: 'cmtmrw9dr04mwf5w9ne7i4hkg',
      conversationId: 'cmtmrw99904muf5w9fuq9ma45',
    });
  });

  it('routes TICKET_STATUS_CHANGE the same way as other TICKET_* events', () => {
    const target = extractTicketRouteTarget({
      type: 'TICKET_STATUS_CHANGE',
      metadata: JSON.stringify({
        ticketId: 'cmtmrw9dr04mwf5w9ne7i4hkg',
        channelId: 'cmoch3q8l00y511eu6vr95uhn',
        conversationId: 'cmtmrw99904muf5w9fuq9ma45',
      }),
    });

    assert.deepEqual(target, {
      channelId: 'cmoch3q8l00y511eu6vr95uhn',
      ticketId: 'cmtmrw9dr04mwf5w9ne7i4hkg',
      conversationId: 'cmtmrw99904muf5w9fuq9ma45',
    });
  });

  it('reads the type from category when type is absent', () => {
    const target = extractTicketRouteTarget({
      category: 'TICKET_PRIORITY_CHANGED',
      metadata: JSON.stringify({ ticketId: 't1', channelId: 'c1' }),
    });
    assert.equal(target?.ticketId, 't1');
    assert.equal(target?.channelId, 'c1');
  });

  it('does not steal chat overlays that already carry a ticketId', () => {
    assert.equal(
      extractTicketRouteTarget({
        type: 'MENTION',
        metadata: JSON.stringify({ ticketId: 't1', channelId: 'c1' }),
      }),
      null,
    );
  });

  it('returns null when there is no ticket identity', () => {
    assert.equal(extractTicketRouteTarget({ type: 'TICKET_PRIORITY_CHANGED' }), null);
    assert.equal(extractTicketRouteTarget({ type: 'SOMETHING_ELSE' }), null);
  });

  it('omits channelId when the payload has none', () => {
    const target = extractTicketRouteTarget({
      type: 'TICKET_PRIORITY_CHANGED',
      metadata: JSON.stringify({ ticketId: 't1' }),
    });
    assert.deepEqual(target, { ticketId: 't1' });
  });
});

describe('shouldPrefetchActivities', () => {
  it('reads the type from category when type is an empty string', () => {
    assert.equal(
      shouldPrefetchActivities({
        type: '',
        category: 'TICKET_PRIORITY_CHANGED',
      }),
      true,
    );
  });
});
