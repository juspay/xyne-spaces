import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildVideoPlaybackFailed,
  buildVideoPlaybackReady,
  classifyVideoPlaybackError,
  extractVideoDecoderName,
  extractVideoErrorCode,
  getVideoFileExtension,
  toVideoErrorMessage,
  toVideoTrackFields,
  VideoPlaybackSession,
} from '@/src/observability/logging/media/videoPlayback';

const IPHONE_MOV = {
  attachmentId: '48547e9b-f76c-40e8-a718-204392779b84',
  mimetype: 'video/quicktime',
  originalFilename: 'IMG_2311.MOV',
  sizeBytes: 106817973,
};

/**
 * Verbatim from Manvith's realme RMX3999 screenshot (19 Oct 2026, 23:01 IST).
 * expo-video's PlaybackError.kt builds it as
 * "A playback exception has occurred: ${localizedMessage} ${cause?.localizedMessage}"
 * — no ExoPlayer ERROR_CODE_* is included.
 */
const REAL_ANDROID_DV_ERROR =
  'A playback exception has occurred: MediaCodecVideoRenderer error, index=0, ' +
  'format=Format(1, null, video/mp4, video/dolby-vision, dvhe.08.04, 8337341, und, ' +
  '[1920, 1080, 29.995493, ColorInfo(BT2020, Limited range, HLG, false, 10bit Luma, 10bit Chroma)], ' +
  '[-1, -1]), format_supported=NO_EXCEEDS_CAPABILITIES Decoder failed: c2.mtk.hevc.decoder';

const DV_TRACK = {
  mimeType: 'video/dolby-vision',
  size: { width: 1920, height: 1080 },
  isSupported: false,
};

describe('video playback telemetry', () => {
  it('classifies the real Android Dolby Vision failure', () => {
    const fields = buildVideoPlaybackFailed({
      surface: 'attachments_viewer',
      stage: 'player_status',
      subject: IPHONE_MOV,
      error: { message: REAL_ANDROID_DV_ERROR },
      openedAtMs: 1000,
      nowMs: 3500,
      reachedReady: false,
      videoTrack: toVideoTrackFields([DV_TRACK]),
    });

    assert.equal(fields.errorCategory, 'decoder_unsupported');
    assert.equal(fields.errorCode, null, 'expo-video never forwards ERROR_CODE_* on Android');
    assert.equal(fields.decoderName, 'c2.mtk.hevc.decoder');
    assert.equal(fields.fileExtension, 'mov');
    assert.equal(fields.sizeBytes, 106817973);
    assert.equal(fields.msSinceOpen, 2500);
    assert.equal(fields.reachedReady, false);
    assert.equal(fields.videoTrackMimeType, 'video/dolby-vision');
    assert.equal(fields.videoTrackWidth, 1920);
    assert.equal(fields.videoTrackHeight, 1080);
    assert.equal(fields.videoTrackIsSupported, false);
    assert.ok(!('originalFilename' in fields), 'never logs the full filename');
  });

  it('labels the iOS AVPlayer loopback connect failure as network', () => {
    assert.equal(
      classifyVideoPlaybackError(
        'player_status',
        'Failed to load the player item: Could not connect to the server.',
      ),
      'network',
    );
  });

  it('labels connectivity failures as network even when the message has an http:// URL', () => {
    const msg =
      'A playback exception has occurred: Source error Unable to connect to http://127.0.0.1:53211/stream?cap=abc123';
    assert.equal(classifyVideoPlaybackError('player_status', msg), 'network');
    assert.equal(
      classifyVideoPlaybackError('player_status', 'ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT'),
      'network',
    );
  });

  it('labels http only on an explicit 4xx/5xx response code', () => {
    assert.equal(
      classifyVideoPlaybackError(
        'player_status',
        'A playback exception has occurred: Source error Response code: 403',
      ),
      'http',
    );
    assert.equal(classifyVideoPlaybackError('player_status', 'Response code: 503'), 'http');
    assert.equal(classifyVideoPlaybackError('player_status', 'HTTP stream ended early'), 'unknown');
    assert.equal(classifyVideoPlaybackError('player_status', 'index=404'), 'unknown');
  });

  it('classifies stream setup and container parse failures', () => {
    assert.equal(classifyVideoPlaybackError('stream_url', 'anything'), 'stream_setup');
    assert.equal(
      classifyVideoPlaybackError(
        'player_status',
        'UnrecognizedInputFormatException: none of the extractors',
      ),
      'container_parse',
    );
    assert.equal(classifyVideoPlaybackError('player_status', 'something odd'), 'unknown');
  });

  it('strips URLs from the logged message', () => {
    const msg = toVideoErrorMessage(
      'Unable to connect to http://127.0.0.1:53211/api/attachments/48547e9b/stream?cap=secret, retry https://x.y/z',
    );
    assert.equal(msg, 'Unable to connect to [url], retry [url]');
    assert.doesNotMatch(msg, /secret|127\.0\.0\.1|attachments/);
  });

  it('parses iOS NSError domain codes', () => {
    assert.equal(
      extractVideoErrorCode(
        'The operation could not be completed (AVFoundationErrorDomain error -11828.)',
      ),
      'AVFoundationErrorDomain:-11828',
    );
    assert.equal(extractVideoErrorCode(REAL_ANDROID_DV_ERROR), null);
    assert.equal(extractVideoDecoderName('no decoder mentioned'), null);
  });

  it('truncates long messages and handles non-Error inputs', () => {
    assert.equal(toVideoErrorMessage(undefined), 'Unknown video playback error');
    assert.equal(toVideoErrorMessage('boom'), 'boom');
    assert.equal(toVideoErrorMessage(new Error('x'.repeat(600))).length, 501);
  });

  it('derives extension only from the filename', () => {
    assert.equal(getVideoFileExtension({ attachmentId: 'a', mimetype: 'video/mp4' }), null);
    assert.equal(
      getVideoFileExtension({ attachmentId: 'a', mimetype: null, originalFilename: 'clip.MP4' }),
      'mp4',
    );
  });

  it('picks the unsupported track and tolerates missing tracks', () => {
    assert.deepEqual(toVideoTrackFields(undefined), {
      videoTrackMimeType: null,
      videoTrackWidth: null,
      videoTrackHeight: null,
      videoTrackIsSupported: null,
    });
    const fields = toVideoTrackFields([
      { mimeType: 'video/hevc', size: { width: 0, height: 0 }, isSupported: true },
      DV_TRACK,
    ]);
    assert.equal(fields.videoTrackMimeType, 'video/dolby-vision');
    assert.equal(fields.videoTrackIsSupported, false);
  });

  it('builds the ready event with time-to-ready, duration and track info', () => {
    const fields = buildVideoPlaybackReady({
      surface: 'attachments_viewer',
      subject: IPHONE_MOV,
      openedAtMs: 100,
      nowMs: 900,
      durationMs: 100_400,
      videoTrack: toVideoTrackFields([
        { mimeType: 'video/avc', size: { width: 1280, height: 720 }, isSupported: true },
      ]),
    });
    assert.equal(fields.timeToReadyMs, 800);
    assert.equal(fields.durationMs, 100_400);
    assert.equal(fields.videoTrackMimeType, 'video/avc');
    assert.equal(fields.videoTrackIsSupported, true);
    const noTrack = buildVideoPlaybackReady({
      surface: 'call_recording',
      subject: IPHONE_MOV,
      openedAtMs: null,
      nowMs: 1,
      durationMs: Number.NaN,
    });
    assert.equal(noTrack.durationMs, null);
    assert.equal(noTrack.videoTrackMimeType, null);
  });

  it('emits at most one ready and one failed event per opened source and resets track info', () => {
    const session = new VideoPlaybackSession();
    session.open(0);
    session.setVideoTrack(toVideoTrackFields([DV_TRACK]));
    assert.equal(session.videoTrack.videoTrackIsSupported, false);
    assert.equal(session.markFailed(), true);
    assert.equal(session.markFailed(), false, 'statusChange + replaceAsync rejection dedupe');
    assert.equal(session.markReady(), false, 'no ready after failure');

    session.open(10);
    assert.equal(session.videoTrack.videoTrackMimeType, null, 'track cleared for new source');
    assert.equal(session.markReady(), true);
    assert.equal(session.markReady(), false);
    assert.equal(session.hasReachedReady, true);
    assert.equal(session.markFailed(), true, 'mid-playback failure still reported');
  });
});
