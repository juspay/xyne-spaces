import {
  getVideoPlaybackSource,
  getVideoPreviewMetadata,
  isBrowserCompatibleVideoStream,
  shouldScheduleVideoPreview,
  withVideoPreviewMetadata,
} from './videoPreviewMetadata';

describe('videoPreviewMetadata', () => {
  it('queues only videos whose browser thumbnail generation failed', () => {
    expect(shouldScheduleVideoPreview('video/mp4', undefined)).toBe(true);
    expect(shouldScheduleVideoPreview('video/quicktime', null)).toBe(true);
    expect(shouldScheduleVideoPreview('video/mp4', 'attachments/thumb.jpg')).toBe(false);
    expect(shouldScheduleVideoPreview('image/png', undefined)).toBe(false);
    expect(shouldScheduleVideoPreview('video/mp4', undefined, undefined, false)).toBe(false);
    expect(shouldScheduleVideoPreview('video/mp4', undefined, { type: 'recording' })).toBe(false);
    expect(shouldScheduleVideoPreview('video/mp4', undefined, { type: 'transcript' })).toBe(false);
  });

  it('skips re-encoding only for browser-compatible H.264 MP4 streams', () => {
    expect(isBrowserCompatibleVideoStream('video/mp4', 'h264', 'yuv420p')).toBe(true);
    expect(isBrowserCompatibleVideoStream('video/quicktime', 'h264', 'yuv420p')).toBe(false);
    expect(isBrowserCompatibleVideoStream('video/mp4', 'h264', 'yuv420p10le')).toBe(false);
    expect(isBrowserCompatibleVideoStream('video/mp4', 'hevc', 'yuv420p')).toBe(false);
  });

  it('keeps the original source until a preview is ready', () => {
    const source = getVideoPlaybackSource(
      'attachments/original.mov',
      'video/quicktime',
      'holiday.mov',
      { videoPreview: { status: 'processing' } }
    );

    expect(source).toEqual({
      url: 'attachments/original.mov',
      mimetype: 'video/quicktime',
      filename: 'holiday.mov',
      isPreview: false,
    });
  });

  it('uses the H.264 derivative for playback without replacing the original', () => {
    const source = getVideoPlaybackSource(
      'attachments/original.mov',
      'video/quicktime',
      'holiday.mov',
      {
        videoPreview: {
          status: 'ready',
          codec: 'hevc',
          previewUrl: 'video-previews/holiday-preview.mp4',
          previewMimetype: 'video/mp4',
        },
      }
    );

    expect(source).toEqual({
      url: 'video-previews/holiday-preview.mp4',
      mimetype: 'video/mp4',
      filename: 'holiday-preview.mp4',
      isPreview: true,
    });
  });

  it('keeps dedicated-bucket recording playback on the original source', () => {
    const source = getVideoPlaybackSource(
      'recordings/original.mp4',
      'video/mp4',
      'recording.mp4',
      {
        type: 'recording',
        videoPreview: { status: 'ready', previewUrl: 'video-previews/stale.mp4' },
      }
    );

    expect(source.url).toBe('recordings/original.mp4');
    expect(source.isPreview).toBe(false);
  });

  it('preserves unrelated attachment metadata when preview state changes', () => {
    const metadata = withVideoPreviewMetadata(
      { duration: 12, source: 'upload' },
      { status: 'pending', requestedAt: '2026-08-04T00:00:00.000Z' }
    );

    expect(metadata.duration).toBe(12);
    expect(metadata.source).toBe('upload');
    expect(getVideoPreviewMetadata(metadata)).toEqual({
      status: 'pending',
      requestedAt: '2026-08-04T00:00:00.000Z',
    });
  });
});
