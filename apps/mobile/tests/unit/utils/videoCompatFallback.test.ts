import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAttachmentStreamUrl } from '@/src/hooks/attachmentCachePolicy';
import {
  COMPAT_RETRY_DELAYS_MS,
  INITIAL_COMPAT_STATE,
  isRecovering,
  onCompatPlayerError,
  onCompatPlayerReady,
  variantForState,
  type CompatFallbackState,
} from '@/src/utils/videoCompatFallback';

/** Verbatim from Manvith's realme RMX3999 (2.1.12 video_playback_failed, 21 Oct 2026). */
const DV_DECODER_ERROR =
  'A playback exception has occurred: MediaCodecVideoRenderer error, index=0, ' +
  'format=Format(1, null, video/mp4, video/dolby-vision, dvhe.08.04, 8337341, und, ' +
  '[1920, 1080, 29.995493, ColorInfo(BT2020, Limited range, HLG, false, 10bit Luma, 10bit Chroma)], ' +
  '[-1, -1]), format_supported=NO_EXCEEDS_CAPABILITIES Decoder failed: c2.mtk.hevc.decoder';
const PENDING_503 = 'A playback exception has occurred: Source error Response code: 503';
const DISABLED_404 = 'A playback exception has occurred: Source error Response code: 404';

describe('compat video fallback', () => {
  it('switches to compat on the Android Dolby Vision decoder failure', () => {
    const { state, action } = onCompatPlayerError(
      INITIAL_COMPAT_STATE,
      DV_DECODER_ERROR,
      'android',
    );
    assert.deepEqual(action, { type: 'load_compat' });
    assert.equal(state.phase, 'compat');
    assert.equal(variantForState(state), 'compat');
    assert.equal(isRecovering(state.phase), true);
    assert.match(state.originalError ?? '', /c2\.mtk\.hevc\.decoder/);
  });

  it('never changes behaviour on iOS or for non-decoder failures', () => {
    for (const [msg, platform] of [
      [DV_DECODER_ERROR, 'ios'],
      ['A playback exception has occurred: Source error Unable to connect to [url]', 'android'],
      [PENDING_503, 'android'],
    ] as const) {
      const r = onCompatPlayerError(INITIAL_COMPAT_STATE, msg, platform);
      assert.deepEqual(r.action, { type: 'show_error' });
      assert.equal(r.state, INITIAL_COMPAT_STATE);
      assert.equal(variantForState(r.state), 'original');
    }
  });

  it('retries with backoff while the server answers 503, then plays', () => {
    let state: CompatFallbackState = onCompatPlayerError(
      INITIAL_COMPAT_STATE,
      DV_DECODER_ERROR,
      'android',
    ).state;
    const first = onCompatPlayerError(state, PENDING_503, 'android');
    assert.deepEqual(first.action, { type: 'retry_compat', delayMs: COMPAT_RETRY_DELAYS_MS[0] });
    assert.equal(first.state.phase, 'preparing');
    state = onCompatPlayerError(first.state, PENDING_503, 'android').state;
    assert.equal(state.attempt, 3);
    state = onCompatPlayerReady(state);
    assert.equal(state.phase, 'compat_ready');
    assert.equal(isRecovering(state.phase), false);
    assert.equal(variantForState(state), 'compat');
  });

  it('gives up after the retry budget and shows the original error', () => {
    let state: CompatFallbackState = onCompatPlayerError(
      INITIAL_COMPAT_STATE,
      DV_DECODER_ERROR,
      'android',
    ).state;
    for (let i = 0; i < COMPAT_RETRY_DELAYS_MS.length; i += 1) {
      const r = onCompatPlayerError(state, PENDING_503, 'android');
      assert.equal(r.action.type, 'retry_compat');
      state = r.state;
    }
    const last = onCompatPlayerError(state, PENDING_503, 'android');
    assert.deepEqual(last.action, { type: 'show_error' });
    assert.equal(last.state.phase, 'unavailable');
    assert.match(last.state.originalError ?? '', /NO_EXCEEDS_CAPABILITIES/);
  });

  it('gives up immediately when the server has no rendition (feature off / failed)', () => {
    const state = onCompatPlayerError(INITIAL_COMPAT_STATE, DV_DECODER_ERROR, 'android').state;
    const r = onCompatPlayerError(state, DISABLED_404, 'android');
    assert.deepEqual(r.action, { type: 'show_error' });
    assert.equal(r.state.phase, 'unavailable');
    assert.equal(
      variantForState(r.state),
      'compat',
      'does not reload the original behind the error',
    );
  });

  it('builds the compat stream URL only when asked', () => {
    const id = '48547e9b-f76c-40e8-a718-204392779b84';
    assert.equal(
      buildAttachmentStreamUrl('https://x/api', id),
      `https://x/api/attachments/${id}/stream`,
    );
    assert.equal(
      buildAttachmentStreamUrl('https://x/api', id, 'compat'),
      `https://x/api/attachments/${id}/stream?variant=compat`,
    );
  });
});
