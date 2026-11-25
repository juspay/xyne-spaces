import type { Request, Response } from 'express';
import { UnreadableString, conversationsSendClient, replyToConversationClient } from '@xyne/shared';
import { requestFacts, runInUnreadableScope } from '@/services/encryption/unreadableScope';
import { unreadableWriteValue } from '@/database/unreadable-extension';
import { unwrapUnreadableResponse } from '../unreadableResponse';

const facts = { userIds: [], groupIds: [], handles: [], mentionsChannel: true, mentionsHere: false, firstUrl: null, prLinks: [], meetLinks: [], commandName: null, commandArgs: null };

describe('requestFacts', () => {
  it("returns the field's facts inside its contract's scope", () => {
    const derived = { version: 2 as const, fields: { content: facts } };
    expect(runInUnreadableScope({ contract: conversationsSendClient, derived }, () => requestFacts(conversationsSendClient, 'content'))).toEqual(facts);
  });

  it('is undefined for a field that carried no text', () => {
    expect(runInUnreadableScope({ contract: conversationsSendClient, derived: undefined }, () => requestFacts(conversationsSendClient, 'content'))).toBeUndefined();
  });

  it('throws outside a scope, and in the scope of another contract', () => {
    expect(() => requestFacts(conversationsSendClient, 'content')).toThrow(/outside its contract route/);
    expect(() =>
      runInUnreadableScope({ contract: replyToConversationClient, derived: undefined }, () => requestFacts(conversationsSendClient, 'content')),
    ).toThrow(/outside its contract route/);
  });
});

describe('unreadableWriteValue', () => {
  it('passes the wrapper through inside a scope and throws outside one', () => {
    const value = UnreadableString.make('ENC:v1|k|abc');
    expect(runInUnreadableScope({ contract: conversationsSendClient, derived: undefined }, () => unreadableWriteValue(value))).toBe(value);
    expect(() => unreadableWriteValue(value)).toThrow(/outside an unreadable route/);
  });
});

describe('unwrapUnreadableResponse', () => {
  it('sends each UnreadableString as the value it holds, leaving everything else as is', () => {
    const sent: unknown[] = [];
    const res = { json: (body: unknown) => (sent.push(body), res) } as unknown as Response;
    const next = jest.fn();
    unwrapUnreadableResponse({} as Request, res, next);
    const createdAt = new Date(0);

    res.json({ initialMessage: { content: UnreadableString.make('ENC:v1|k|abc'), createdAt }, list: [UnreadableString.make('hi'), 1] });

    expect(next).toHaveBeenCalled();
    expect(sent).toEqual([{ initialMessage: { content: 'ENC:v1|k|abc', createdAt }, list: ['hi', 1] }]);
    expect((sent[0] as { initialMessage: { createdAt: Date } }).initialMessage.createdAt).toBe(createdAt);
  });
});
