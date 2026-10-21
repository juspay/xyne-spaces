import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CallType } from '@xyne/shared';

import {
  parseCallDismissPayload,
  parseIncomingCallPayload,
} from '@/src/services/PushNotificationPayload';

describe('parseIncomingCallPayload', () => {
  it('rejects non-object input', () => {
    assert.equal(parseIncomingCallPayload(null), null);
    assert.equal(parseIncomingCallPayload(undefined), null);
    assert.equal(parseIncomingCallPayload('INCOMING_CALL'), null);
  });

  it('rejects payloads that are not call notifications', () => {
    assert.equal(parseIncomingCallPayload({ type: 'MESSAGE', callId: 'c1' }), null);
  });

  it('rejects a valid call notification that carries no call id', () => {
    assert.equal(parseIncomingCallPayload({ type: 'INCOMING_CALL' }), null);
  });

  it('parses a full payload from a JSON metadata string', () => {
    const payload = parseIncomingCallPayload({
      type: 'INCOMING_CALL',
      metadata: JSON.stringify({
        callId: 'call-1',
        callerName: 'Alice',
        callType: 'VIDEO',
        channelId: 'chan-1',
        token: 'tok-1',
        liveKitUrl: 'wss://livekit.example',
      }),
    });

    assert.deepEqual(payload, {
      callId: 'call-1',
      callUUID: 'call-1',
      callerName: 'Alice',
      callType: CallType.VIDEO,
      channelId: 'chan-1',
      token: 'tok-1',
      serverUrl: 'wss://livekit.example',
    });
  });

  it('accepts isIncomingCall, top-level callId, msg_title and defaults callType to audio', () => {
    const payload = parseIncomingCallPayload({
      isIncomingCall: true,
      callId: 'call-2',
      msg_title: 'Bob',
    });

    assert.deepEqual(payload, {
      callId: 'call-2',
      callUUID: 'call-2',
      callerName: 'Bob',
      callType: CallType.AUDIO,
    });
  });

  it('accepts the answer background action and uses relatedEntityId with a default caller name', () => {
    const payload = parseIncomingCallPayload({
      callAction: 'answer',
      relatedEntityId: 'call-3',
    });

    assert.deepEqual(payload, {
      callId: 'call-3',
      callUUID: 'call-3',
      callerName: 'Unknown Caller',
      callType: CallType.AUDIO,
    });
  });

  it('accepts the decline background action', () => {
    const payload = parseIncomingCallPayload({ callAction: 'decline', callId: 'call-4' });
    assert.equal(payload?.callId, 'call-4');
  });

  it('reads metadata supplied as an object and prefers VIDEO call type', () => {
    const payload = parseIncomingCallPayload({
      type: 'INCOMING_CALL',
      metadata: { callId: 'call-5', callType: 'VIDEO' },
    });

    assert.equal(payload?.callType, CallType.VIDEO);
    assert.equal(payload?.callId, 'call-5');
  });

  it('falls back to top-level data when the metadata string is invalid JSON', () => {
    const payload = parseIncomingCallPayload({
      type: 'INCOMING_CALL',
      metadata: '{not-valid-json',
      callId: 'call-6',
      msg_title: 'Carol',
    });

    assert.deepEqual(payload, {
      callId: 'call-6',
      callUUID: 'call-6',
      callerName: 'Carol',
      callType: CallType.AUDIO,
    });
  });

  it('uses metadata serverUrl when no liveKitUrl is present', () => {
    const payload = parseIncomingCallPayload({
      type: 'INCOMING_CALL',
      metadata: { callId: 'call-7', serverUrl: 'https://sfu.example' },
    });

    assert.equal(payload?.serverUrl, 'https://sfu.example');
  });
});

describe('parseCallDismissPayload', () => {
  it('rejects non-object input', () => {
    assert.equal(parseCallDismissPayload(null), null);
    assert.equal(parseCallDismissPayload('CALL_DISMISS'), null);
  });

  it('rejects unrelated notification types', () => {
    assert.equal(parseCallDismissPayload({ type: 'INCOMING_CALL' }), null);
  });

  it('parses a CALL_DISMISS with a metadata call id', () => {
    assert.deepEqual(
      parseCallDismissPayload({
        type: 'CALL_DISMISS',
        metadata: { callId: 'call-8' },
      }),
      { type: 'CALL_DISMISS', callId: 'call-8' },
    );
  });

  it('parses a MISSED_CALL using relatedEntityId', () => {
    assert.deepEqual(parseCallDismissPayload({ type: 'MISSED_CALL', relatedEntityId: 'call-9' }), {
      type: 'MISSED_CALL',
      callId: 'call-9',
    });
  });

  it('omits the call id when none is present', () => {
    assert.deepEqual(parseCallDismissPayload({ type: 'CALL_DISMISS' }), {
      type: 'CALL_DISMISS',
    });
  });
});
