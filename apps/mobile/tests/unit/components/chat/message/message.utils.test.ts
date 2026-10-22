import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MessageType } from '@xyne/shared';

import type {
  MessageForRender,
  MessageRootProps,
} from '@/src/components/chat/message/message.types';
import {
  formatDateLabel,
  getInitialMessage,
  getIsOwnMessage,
  getMessageMsgType,
  getMessageText,
  getMessageTime,
  getSenderFromConversation,
  getTicketData,
  getTicketIdFromMetadata,
  isNewMessageBoundary,
  isSameDay,
  isTicketMessage,
  messageRowHasLinkedTicket,
  shouldShowMessageEditedLabel,
} from '@/src/components/chat/message/message.utils';

const asRender = (value: unknown): MessageForRender => value as unknown as MessageForRender;
const asRoot = (value: unknown): MessageRootProps['message'] =>
  value as unknown as MessageRootProps['message'];

describe('getSenderFromConversation', () => {
  it('returns null when there is no initial message', () => {
    assert.equal(getSenderFromConversation(asRoot({ initialMessage: null })), null);
  });

  it('returns the attached sender relation when present', () => {
    const sender = { id: 's1', name: 'Krishna', picture: 'p.png' };
    assert.deepEqual(getSenderFromConversation(asRoot({ initialMessage: { sender } })), sender);
  });

  it('returns null when the initial message carries no sender relation', () => {
    assert.equal(getSenderFromConversation(asRoot({ initialMessage: { senderId: 's1' } })), null);
  });
});

describe('getInitialMessage', () => {
  it('returns the nested initial message object', () => {
    const initialMessage = { content: 'hi' };
    assert.equal(getInitialMessage(asRoot({ initialMessage })), initialMessage);
  });
});

describe('getIsOwnMessage', () => {
  it('is true when the sender matches the current user', () => {
    assert.equal(
      getIsOwnMessage(asRoot({ currentUserId: 'u1', initialMessage: { senderId: 'u1' } })),
      true,
    );
  });

  it('is false when the sender differs from the current user', () => {
    assert.equal(
      getIsOwnMessage(asRoot({ currentUserId: 'u1', initialMessage: { senderId: 'u2' } })),
      false,
    );
  });

  it('is false when there is no initial message', () => {
    assert.equal(getIsOwnMessage(asRoot({ currentUserId: 'u1', initialMessage: null })), false);
  });
});

describe('getMessageMsgType', () => {
  it('returns the explicit message type', () => {
    assert.equal(
      getMessageMsgType(asRender({ initialMessage: { msgType: MessageType.SYSTEM } })),
      MessageType.SYSTEM,
    );
  });

  it('defaults to USER when no type is present', () => {
    assert.equal(getMessageMsgType(asRender({ initialMessage: {} })), MessageType.USER);
    assert.equal(getMessageMsgType(asRender({ initialMessage: null })), MessageType.USER);
  });
});

describe('messageRowHasLinkedTicket', () => {
  it('is true when a ticket relation is attached', () => {
    assert.equal(messageRowHasLinkedTicket(asRender({ ticket: { id: 'T1' } })), true);
  });

  it('is true when a non-empty ticketId is present on the row', () => {
    assert.equal(messageRowHasLinkedTicket(asRender({ ticketId: 'T1' })), true);
  });

  it('is false for a blank ticketId or no linkage', () => {
    assert.equal(messageRowHasLinkedTicket(asRender({ ticketId: '' })), false);
    assert.equal(messageRowHasLinkedTicket(asRender({})), false);
  });
});

describe('isTicketMessage', () => {
  it('is true when the row is linked to a ticket', () => {
    assert.equal(isTicketMessage(asRender({ ticket: { id: 'T1' } })), true);
  });

  it('is true when metadata carries a ticketId that is not a ticket activity', () => {
    assert.equal(
      isTicketMessage(asRender({ initialMessage: { metadata: { ticketId: 'T1' } } })),
      true,
    );
  });

  it('is false when metadata marks it as a ticket activity', () => {
    assert.equal(
      isTicketMessage(
        asRender({ initialMessage: { metadata: { ticketId: 'T1', isTicketActivity: true } } }),
      ),
      false,
    );
  });

  it('is false when metadata is empty or absent', () => {
    assert.equal(isTicketMessage(asRender({ initialMessage: { metadata: {} } })), false);
    assert.equal(isTicketMessage(asRender({ initialMessage: {} })), false);
  });
});

describe('getTicketData', () => {
  it('returns the attached ticket when present', () => {
    const ticket = { id: 'T1' };
    assert.equal(getTicketData(asRender({ ticket })), ticket);
  });

  it('returns null when there is no ticket relation', () => {
    assert.equal(getTicketData(asRender({})), null);
  });
});

describe('getTicketIdFromMetadata', () => {
  it('returns the metadata ticketId when it is a non-empty string', () => {
    assert.equal(
      getTicketIdFromMetadata(asRender({ initialMessage: { metadata: { ticketId: 'T1' } } })),
      'T1',
    );
  });

  it('returns null for ticket activities', () => {
    assert.equal(
      getTicketIdFromMetadata(
        asRender({ initialMessage: { metadata: { ticketId: 'T1', isTicketActivity: true } } }),
      ),
      null,
    );
  });

  it('returns null for blank or missing ticketId', () => {
    assert.equal(
      getTicketIdFromMetadata(asRender({ initialMessage: { metadata: { ticketId: '  ' } } })),
      null,
    );
    assert.equal(getTicketIdFromMetadata(asRender({ initialMessage: {} })), null);
  });
});

describe('shouldShowMessageEditedLabel', () => {
  it('shows the label for an edited, non-deleted, non-system message', () => {
    assert.equal(
      shouldShowMessageEditedLabel(
        asRender({ initialMessage: { edited: true } }),
        MessageType.USER,
      ),
      true,
    );
  });

  it('hides the label when the message was not edited', () => {
    assert.equal(
      shouldShowMessageEditedLabel(
        asRender({ initialMessage: { edited: false } }),
        MessageType.USER,
      ),
      false,
    );
  });

  it('hides the label for deleted messages', () => {
    assert.equal(
      shouldShowMessageEditedLabel(
        asRender({ initialMessage: { edited: true, isDeleted: true } }),
        MessageType.USER,
      ),
      false,
    );
  });

  it('hides the label for system messages', () => {
    assert.equal(
      shouldShowMessageEditedLabel(
        asRender({ initialMessage: { edited: true } }),
        MessageType.SYSTEM,
      ),
      false,
    );
  });
});

describe('getMessageText', () => {
  it('returns the initial message content', () => {
    assert.equal(getMessageText(asRoot({ initialMessage: { content: 'hello' } })), 'hello');
  });

  it('falls back to an empty string', () => {
    assert.equal(getMessageText(asRoot({ initialMessage: { content: '' } })), '');
    assert.equal(getMessageText(asRoot({ initialMessage: null })), '');
  });
});

describe('getMessageTime', () => {
  it('formats the initial message timestamp as h:mm a', () => {
    const ts = new Date(2024, 0, 15, 9, 5, 0).getTime();
    assert.equal(getMessageTime(asRoot({ initialMessage: { createdAt: ts } })), '9:05 AM');
  });

  it('falls back to the row createdAt when the initial message lacks one', () => {
    const ts = new Date(2024, 0, 15, 14, 30, 0).getTime();
    assert.equal(getMessageTime(asRoot({ initialMessage: {}, createdAt: ts })), '2:30 PM');
  });
});

describe('formatDateLabel', () => {
  it('formats a timestamp as weekday, day month', () => {
    const ts = new Date(2024, 0, 15).getTime();
    assert.equal(formatDateLabel(ts), 'Monday, 15 January');
  });

  it('keeps the month for a mid-month current-year date', () => {
    const ts = new Date(2026, 8, 13, 12, 0, 0).getTime();
    assert.equal(formatDateLabel(ts), 'Sunday, 13 September');
  });
});

describe('isSameDay', () => {
  it('is true for two timestamps on the same calendar day', () => {
    const a = new Date(2024, 0, 15, 1, 0, 0).getTime();
    const b = new Date(2024, 0, 15, 23, 59, 0).getTime();
    assert.equal(isSameDay(a, b), true);
  });

  it('is false across a day boundary', () => {
    const a = new Date(2024, 0, 15, 23, 59, 0).getTime();
    const b = new Date(2024, 0, 16, 0, 1, 0).getTime();
    assert.equal(isSameDay(a, b), false);
  });
});

describe('isNewMessageBoundary', () => {
  const boundaryMessage = (createdAt: number): MessageForRender =>
    asRender({
      createdAt,
      currentUserId: 'u1',
      initialMessage: { senderId: 'u2', msgType: MessageType.USER },
    });

  it('is false when there is no valid lastViewedAt', () => {
    assert.equal(isNewMessageBoundary(boundaryMessage(200), undefined, undefined), false);
    assert.equal(isNewMessageBoundary(boundaryMessage(200), undefined, 0), false);
  });

  it('is false when the message was created at or before lastViewedAt', () => {
    assert.equal(isNewMessageBoundary(boundaryMessage(100), undefined, 100), false);
  });

  it('is false when the message is authored by the current user', () => {
    const message = asRender({
      createdAt: 200,
      currentUserId: 'u1',
      initialMessage: { senderId: 'u1', msgType: MessageType.USER },
    });
    assert.equal(isNewMessageBoundary(message, undefined, 100), false);
  });

  it('is false for a non-ticket system message', () => {
    const message = asRender({
      createdAt: 200,
      currentUserId: 'u1',
      initialMessage: { senderId: 'u2', msgType: MessageType.SYSTEM },
    });
    assert.equal(isNewMessageBoundary(message, undefined, 100), false);
  });

  it('is false when the previous message is already past lastViewedAt', () => {
    const previous = boundaryMessage(150);
    assert.equal(isNewMessageBoundary(boundaryMessage(200), previous, 100), false);
  });

  it('is true for the first unseen message from another user', () => {
    assert.equal(isNewMessageBoundary(boundaryMessage(200), undefined, 100), true);
    const previous = boundaryMessage(90);
    assert.equal(isNewMessageBoundary(boundaryMessage(200), previous, 100), true);
  });
});
