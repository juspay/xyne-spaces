import { describe, it, expect } from 'vitest';
import {
  buildMessageLink,
  extractOriginFromHash,
  extractMessageIdFromHash,
  extractCreatedAtFromHash,
} from './messageLink';

const ORIGIN = 'https://app.spaces.xyne.juspay.net';
const CHANNEL = 'chan_1';
const CONV = 'conv_abc';
const MSG = 'msg_xyz';
const CREATED = 1712345678901;

const hashOf = (url: string): string => url.slice(url.indexOf('#'));

describe('buildMessageLink', () => {
  it('embeds the createdAt anchor for channel messages', () => {
    const url = buildMessageLink({
      shareableOrigin: ORIGIN,
      channelId: CHANNEL,
      conversationId: CONV,
      messageId: MSG,
      createdAt: CREATED,
      context: 'channel',
    });
    expect(url).toBe(
      `${ORIGIN}/chat/dir/${CHANNEL}#origin=${CONV}&createdAt=${CREATED}`,
    );
    expect(extractOriginFromHash(hashOf(url))).toBe(CONV);
    expect(extractCreatedAtFromHash(hashOf(url))).toBe(CREATED);
  });

  it('embeds messageId and createdAt for thread messages', () => {
    const url = buildMessageLink({
      shareableOrigin: ORIGIN,
      channelId: CHANNEL,
      conversationId: CONV,
      messageId: MSG,
      createdAt: CREATED,
      context: 'thread',
    });
    expect(url).toBe(
      `${ORIGIN}/chat/dir/${CHANNEL}/${CONV}#origin=${CONV}&messageId=${MSG}&createdAt=${CREATED}`,
    );
    expect(extractOriginFromHash(hashOf(url))).toBe(CONV);
    expect(extractMessageIdFromHash(hashOf(url))).toBe(MSG);
    expect(extractCreatedAtFromHash(hashOf(url))).toBe(CREATED);
  });

  it('omits createdAt when it is missing or invalid (backward compatible)', () => {
    const url = buildMessageLink({
      shareableOrigin: ORIGIN,
      channelId: CHANNEL,
      conversationId: CONV,
      messageId: MSG,
      createdAt: null,
      context: 'channel',
    });
    expect(url).toBe(`${ORIGIN}/chat/dir/${CHANNEL}#origin=${CONV}`);
    expect(url).not.toContain('createdAt');
    expect(extractCreatedAtFromHash(hashOf(url))).toBeNull();
  });

  it('messageId parsing is not polluted by a trailing createdAt param', () => {
    const url = buildMessageLink({
      shareableOrigin: ORIGIN,
      channelId: CHANNEL,
      conversationId: CONV,
      messageId: MSG,
      createdAt: CREATED,
      context: 'thread',
    });
    // messageId must stop at the & before createdAt, not swallow it
    expect(extractMessageIdFromHash(hashOf(url))).toBe(MSG);
  });
});

describe('receiver behaviour parity (ConversationPanelV2 enable-condition)', () => {
  // ConversationPanelV2 disables the slow getConversationByIdWithChannel lookup
  // when a createdAt anchor is present in the hash:
  //   enabled: !!urlConversationId && !urlCreatedAtMatch && stateLinkedItemCreatedAt === null
  const idLookupEnabled = (hash: string): boolean => {
    const urlConversationId = extractOriginFromHash(hash);
    const urlCreatedAtMatch = /createdAt=([^&#]+)/.test(hash);
    return !!urlConversationId && !urlCreatedAtMatch;
  };

  it('OLD link (no createdAt) falls back to the slow ID lookup', () => {
    const oldLink = `${ORIGIN}/chat/dir/${CHANNEL}#origin=${CONV}`;
    expect(idLookupEnabled(hashOf(oldLink))).toBe(true);
  });

  it('NEW link (with createdAt) skips the slow ID lookup and uses the snapshot window', () => {
    const newLink = buildMessageLink({
      shareableOrigin: ORIGIN,
      channelId: CHANNEL,
      conversationId: CONV,
      messageId: MSG,
      createdAt: CREATED,
      context: 'channel',
    });
    expect(idLookupEnabled(hashOf(newLink))).toBe(false);
    expect(extractCreatedAtFromHash(hashOf(newLink))).toBe(CREATED);
  });
});
