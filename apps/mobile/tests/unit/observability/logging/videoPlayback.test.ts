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
  VideoPlaybackSession,
} from '@/src/observability/logging/media/videoPlayback';

const IPHONE_MOV = {
  attachmentId: '48547e9b-f76c-40e8-a718-204392779b84',
  mimetype: 'video/quicktime',
  originalFilename: 'IMG_2311.MOV',
  sizeBytes: 106817973,
};

const EXO_DECODER_ERROR =
  'androidx.media3.exoplayer.ExoPlaybackException: MediaCodecVideoRenderer error, index=0, ' +
  'format=Format(1, null, video/mp4, video/dolby-vision, dvhe.08.04, -1, null, [1920, 1080, 29.97]), ' +
  'format_supported=NO_EXCEEDS_CAPABILITIES ERROR_CODE_DECODER_INIT_FAILED ' +
  'Decoder init failed: c2.mtk.hevc.decoder';

describe('video playback telemetry', () => {
  it('classifies the Android Dolby Vision decoder failure and extracts code + decoder', () => {
    const fields = buildVideoPlaybackFailed({
      surface: 'chat_viewer',
      stage: 'player_status',
      subject: IPHONE_MOV,
      error: { message: EXO_DECODER_ERROR },
      openedAtMs: 1000,
      nowMs: 3500,
      reachedReady: false,
    });

    assert.equal(fields.errorCategory, 'decoder_unsupported');
    assert.equal(fields.errorCode, 'ERROR_CODE_DECODER_INIT_FAILED');
    assert.equal(fields.decoderName, 'c2.mtk.hevc.decoder');
    assert.equal(fields.fileExtension, 'mov');
    assert.equal(fields.sizeBytes, 106817973);
    assert.equal(fields.msSinceOpen, 2500);
    assert.equal(fields.reachedReady, false);
    assert.ok(!('originalFilename' in fields), 'never logs the full filename');
  });

  it('classifies stream setup, http, network and parse failures', () => {
    assert.equal(classifyVideoPlaybackError('stream_url', 'anything'), 'stream_setup');
    assert.equal(
      classifyVideoPlaybackError(
        'player_status',
        'InvalidResponseCodeException: Response code: 403',
      ),
      'http',
    );
    assert.equal(
      classifyVideoPlaybackError('player_status', 'ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT'),
      'network',
    );
    assert.equal(
      classifyVideoPlaybackError(
        'player_status',
        'UnrecognizedInputFormatException: none of the extractors',
      ),
      'container_parse',
    );
    assert.equal(classifyVideoPlaybackError('player_status', 'something odd'), 'unknown');
  });

  it('parses iOS NSError domain codes', () => {
    assert.equal(
      extractVideoErrorCode(
        'The operation could not be completed (AVFoundationErrorDomain error -11828.)',
      ),
      'AVFoundationErrorDomain:-11828',
    );
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

  it('builds the ready event with time-to-ready and duration', () => {
    const fields = buildVideoPlaybackReady({
      surface: 'attachments_viewer',
      subject: IPHONE_MOV,
      openedAtMs: 100,
      nowMs: 900,
      durationMs: 100_400,
    });
    assert.equal(fields.timeToReadyMs, 800);
    assert.equal(fields.durationMs, 100_400);
    assert.equal(
      buildVideoPlaybackReady({
        surface: 'call_recording',
        subject: IPHONE_MOV,
        openedAtMs: null,
        nowMs: 1,
        durationMs: Number.NaN,
      }).durationMs,
      null,
    );
  });

  it('emits at most one ready and one failed event per opened source', () => {
    const session = new VideoPlaybackSession();
    session.open(0);
    assert.equal(session.markFailed(), true);
    assert.equal(session.markFailed(), false, 'statusChange + replaceAsync rejection dedupe');
    assert.equal(session.markReady(), false, 'no ready after failure');

    session.open(10);
    assert.equal(session.markReady(), true);
    assert.equal(session.markReady(), false);
    assert.equal(session.hasReachedReady, true);
    assert.equal(session.markFailed(), true, 'mid-playback failure still reported');
  });
});
