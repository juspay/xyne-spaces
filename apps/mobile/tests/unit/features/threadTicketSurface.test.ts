import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readConversationTicketId } from '@/src/features/chat/navigation/threadTicketSurface';

describe('thread ticket surface', (): void => {
  it('prefers the conversation ticket id when it is present', (): void => {
    assert.equal(readConversationTicketId({ ticketId: 'ticket-1' }), 'ticket-1');
  });

  it('reads a nested ticket identity', (): void => {
    assert.equal(readConversationTicketId({ ticket: { id: 'ticket-2' } }), 'ticket-2');
  });

  it('falls back to ticket markdown metadata', (): void => {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const conversation = { ticket_md: ':::ticket\nid: ticket-3\n:::' };
    assert.equal(readConversationTicketId(conversation), 'ticket-3');
  });

  it('leaves ordinary threads on the chat surface', (): void => {
    assert.equal(readConversationTicketId({}), null);
  });
});
