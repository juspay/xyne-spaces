import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TICKET_ROUTE,
  baseChatRouteSingular,
} from '@/src/features/chat/navigation/chatRoutePolicy';

describe('chatRoutePolicy', () => {
  it('exposes the ticket route as an Expo Router dynamic segment', () => {
    assert.equal(TICKET_ROUTE, '/ticket/[ticketId]');
  });

  it('collapses concurrent base-chat pushes onto one stable stack id', () => {
    const id = baseChatRouteSingular();
    assert.equal(id, 'base-chat');
    // Must be idempotent so a double-push resolves to the same screen.
    assert.equal(baseChatRouteSingular(), id);
  });
});
