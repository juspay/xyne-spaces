import { fcmPushService, type FcmNotificationPayload } from '@/services/fcmService';

// Reaches the private serializer on the real singleton. `private` is a
// compile-time-only marker in TS, so the method exists at runtime.
const buildDataPayload = (
  payload: FcmNotificationPayload,
  isSilent = false,
): Record<string, string> =>
  (fcmPushService as unknown as {
    buildDataPayload: (p: FcmNotificationPayload, s: boolean) => Record<string, string>;
  }).buildDataPayload(payload, isSilent);

const dataBytes = (data: Record<string, string>): number =>
  Object.entries(data).reduce(
    (sum, [k, v]) => sum + Buffer.byteLength(k, 'utf8') + Buffer.byteLength(v, 'utf8'),
    0,
  );

const FCM_HARD_LIMIT = 4096;

// Mimics the metadata built in notificationService.ts (~L979) for a
// CHANNEL_MESSAGE: the full `conversation` blob with body + attachments.
function makeOversizedChannelMessage(): FcmNotificationPayload {
  const bigBody = 'A'.repeat(6000); // a long channel message
  return {
    title: 'New message in #merchant-incidents',
    message: bigBody,
    type: 'CHANNEL_MESSAGE',
    notificationId: 'notif-123',
    relatedEntityType: 'message',
    relatedEntityId: 'msg-1',
    actionUrl: '/ws-1/chat/chan-1#origin=conv-1&messageId=msg-1',
    metadata: {
      channelId: 'chan-1',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      senderId: 'user-sender',
      senderName: 'Samit Barai',
      senderPicture: 'https://cdn.example.com/avatars/samit.png',
      channelTitle: 'merchant-incidents',
      messageType: 'channel_message',
      conversation: {
        conversationId: 'conv-1',
        initial_message_md: bigBody,
        attachments: Array.from({ length: 5 }, (_, i) => ({
          id: `att-${i}`,
          url: `https://cdn.example.com/files/attachment-${i}-${'x'.repeat(200)}.pdf`,
          name: `attachment-${i}.pdf`,
        })),
      },
    },
  };
}

describe('fcmService.buildDataPayload — 4KB FCM data limit', () => {
  it('BUG REPRO: the raw metadata blob alone blows past FCM 4KB limit', () => {
    const payload = makeOversizedChannelMessage();
    const rawMetadataBytes = Buffer.byteLength(JSON.stringify(payload.metadata), 'utf8');
    // This is what the OLD code stringified verbatim into data.metadata.
    expect(rawMetadataBytes).toBeGreaterThan(FCM_HARD_LIMIT);
  });

  it('FIX: assembled data map stays under the 4KB FCM hard limit', () => {
    const data = buildDataPayload(makeOversizedChannelMessage());
    expect(dataBytes(data)).toBeLessThan(FCM_HARD_LIMIT);
  });

  it('FIX: drops the heavy `conversation` blob but keeps deep-link id fields', () => {
    const data = buildDataPayload(makeOversizedChannelMessage());
    const meta = JSON.parse(data.metadata) as Record<string, unknown>;
    expect(meta.conversation).toBeUndefined();
    // Everything the native client actually reads must survive.
    expect(meta.channelId).toBe('chan-1');
    expect(meta.conversationId).toBe('conv-1');
    expect(meta.messageId).toBe('msg-1');
    expect(meta.senderId).toBe('user-sender');
    expect(meta.senderName).toBe('Samit Barai');
    expect(meta.senderPicture).toBe('https://cdn.example.com/avatars/samit.png');
    expect(meta.channelTitle).toBe('merchant-incidents');
    expect(meta.messageType).toBe('channel_message');
    // Deep-link + id passthroughs the client uses on tap.
    expect(data.notificationId).toBe('notif-123');
    expect(data.deeplink).toBe('/ws-1/chat/chan-1#origin=conv-1&messageId=msg-1');
  });

  it('FIX: bounds an oversized msg_body to <= 500 chars', () => {
    const data = buildDataPayload(makeOversizedChannelMessage());
    expect(data.msg_body.length).toBeLessThanOrEqual(500);
  });

  it('NO REGRESSION: a normal small payload passes through untouched', () => {
    const payload: FcmNotificationPayload = {
      title: 'New message in #general',
      message: 'hey, can you check this?',
      type: 'CHANNEL_MESSAGE',
      notificationId: 'notif-small',
      actionUrl: '/ws-1/chat/chan-2',
      metadata: {
        channelId: 'chan-2',
        conversationId: 'conv-2',
        messageId: 'msg-2',
        senderName: 'Balaji B',
        messageType: 'channel_message',
      },
    };
    const data = buildDataPayload(payload);
    const meta = JSON.parse(data.metadata) as Record<string, unknown>;
    expect(meta.channelId).toBe('chan-2');
    expect(meta.senderName).toBe('Balaji B');
    expect(data.msg_body).toBe('hey, can you check this?');
    expect(dataBytes(data)).toBeLessThan(FCM_HARD_LIMIT);
  });

  it('NO REGRESSION: call-notification metadata (callId/roomLink) is preserved', () => {
    const payload: FcmNotificationPayload = {
      title: 'Incoming call',
      message: 'Krishan is calling',
      type: 'INCOMING_CALL',
      metadata: {
        callId: 'call-1',
        callerName: 'Krishan Kumar Saini',
        callType: 'AUDIO',
        channelId: 'chan-3',
        roomLink: 'https://livekit.example.com/room/abc',
        serverUrl: 'wss://livekit.example.com',
      },
    };
    const data = buildDataPayload(payload);
    const meta = JSON.parse(data.metadata) as Record<string, unknown>;
    // A message-only whitelist would have wiped these and broken calls.
    expect(meta.callId).toBe('call-1');
    expect(meta.callerName).toBe('Krishan Kumar Saini');
    expect(meta.roomLink).toBe('https://livekit.example.com/room/abc');
    expect(meta.serverUrl).toBe('wss://livekit.example.com');
  });
});
