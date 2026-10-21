import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deskTabForRequestedTab,
  parseDeskTicketTab,
  resolveDeskTicketRoute,
} from '@/src/features/xyne-desks/detail/utils/desk-ticket-route';

const base = {
  ticketUuid: 'tkt-uuid-1',
  xyneId: 'MERCHANTS1-62036',
  channelId: 'ch-desk',
  channelType: 'EMAIL',
  isDeskMember: true,
};

describe('resolveDeskTicketRoute', () => {
  it('routes an email-desk ticket to the Desk screen on the Email tab', () => {
    assert.deepEqual(resolveDeskTicketRoute(base), {
      pathname: '/xyne-desks/[channelId]/[ticketId]',
      params: {
        channelId: 'ch-desk',
        ticketId: 'MERCHANTS1-62036',
        id: 'tkt-uuid-1',
        tab: 'email',
      },
    });
  });

  it('opens the Messages tab for an internal thread reply', () => {
    assert.equal(
      resolveDeskTicketRoute({ ...base, requestedTab: 'thread' })?.params.tab,
      'messages',
    );
  });

  it('routes Slack and App desks too', () => {
    assert.ok(resolveDeskTicketRoute({ ...base, channelType: 'SLACK' }));
    assert.ok(resolveDeskTicketRoute({ ...base, channelType: 'app' }));
  });

  it('falls back to the uuid when the xyneId is not known yet', () => {
    const route = resolveDeskTicketRoute({ ...base, xyneId: null });
    assert.equal(route?.params.ticketId, 'tkt-uuid-1');
    assert.equal(route?.params.id, 'tkt-uuid-1');
  });

  it('keeps regular channels on the standard ticket screen', () => {
    assert.equal(resolveDeskTicketRoute({ ...base, channelType: 'DEFAULT' }), null);
    assert.equal(resolveDeskTicketRoute({ ...base, channelType: undefined }), null);
  });

  it('keeps desk types without a mobile Desk screen on the standard screen', () => {
    assert.equal(resolveDeskTicketRoute({ ...base, channelType: 'CALL' }), null);
    assert.equal(resolveDeskTicketRoute({ ...base, channelType: 'SOCIAL_MEDIA' }), null);
  });

  it('keeps non-members on the standard screen', () => {
    assert.equal(resolveDeskTicketRoute({ ...base, isDeskMember: false }), null);
  });

  it('returns null when ids are missing', () => {
    assert.equal(resolveDeskTicketRoute({ ...base, channelId: '  ' }), null);
    assert.equal(resolveDeskTicketRoute({ ...base, ticketUuid: '' }), null);
  });
});

describe('deskTabForRequestedTab', () => {
  it('maps thread to messages and everything else to email', () => {
    assert.equal(deskTabForRequestedTab('thread'), 'messages');
    assert.equal(deskTabForRequestedTab('overview'), 'email');
    assert.equal(deskTabForRequestedTab('activity'), 'email');
    assert.equal(deskTabForRequestedTab(undefined), 'email');
  });
});

describe('parseDeskTicketTab', () => {
  it('accepts known Desk tabs only', () => {
    assert.equal(parseDeskTicketTab('messages'), 'messages');
    assert.equal(parseDeskTicketTab(['details']), 'details');
    assert.equal(parseDeskTicketTab('thread'), null);
    assert.equal(parseDeskTicketTab(undefined), null);
  });
});
