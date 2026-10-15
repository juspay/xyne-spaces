import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { callContentFor, callPreviewFromMetadata } from '../model/callPreview';

describe('callPreviewFromMetadata', (): void => {
  it('requires the explicit call-message flag', (): void => {
    assert.equal(callPreviewFromMetadata(null), null);
    assert.equal(callPreviewFromMetadata({ callId: 'call-1' }), null);
  });

  it('normalizes optional strings and keeps structured call metadata', (): void => {
    assert.deepEqual(
      callPreviewFromMetadata({
        isCallMessage: true,
        callId: ' call-1 ',
        callTitle: ' Design review ',
        operation: ' call_ended ',
        durationMs: 90_000,
      }),
      {
        callId: 'call-1',
        title: 'Design review',
        operation: 'call_ended',
        durationMs: 90_000,
      },
    );
  });

  it('uses safe fallbacks for malformed optional values', (): void => {
    assert.deepEqual(
      callPreviewFromMetadata({
        isCallMessage: true,
        callTitle: '   ',
        durationMs: -1,
      }),
      {
        callId: null,
        title: 'Call',
        operation: null,
        durationMs: null,
      },
    );
  });

  it('uses the rendered call message body for the transcript heading', (): void => {
    const call = callPreviewFromMetadata({ isCallMessage: true, callTitle: 'Metadata title' });
    assert.ok(call);
    assert.equal(
      callContentFor(call, { plainText: ' Actual call summary ', markdown: 'fallback' }),
      'Actual call summary',
    );
    assert.equal(callContentFor(call, { plainText: '', markdown: '' }), 'Metadata title');
  });
});
