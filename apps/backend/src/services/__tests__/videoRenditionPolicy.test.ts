import {
  decideCompat,
  FAILED_RETRY_AFTER_MS,
  isTerminalStatus,
  transcodeTimeoutMs,
} from '../videoRenditionPolicy';
import { buildCompatTranscodeArgs, type VideoProbe } from '../../utils/ffmpeg';

/** ffprobe of IMG_2311.MOV-like iPhone HDR recording (Dolby Vision 8.4 over HEVC Main10 HLG). */
const IPHONE_DV_PROBE: VideoProbe = {
  streams: [
    {
      codec_type: 'video',
      codec_name: 'hevc',
      profile: 'Main 10',
      pix_fmt: 'yuv420p10le',
      width: 1920,
      height: 1080,
      color_transfer: 'arib-std-b67',
      color_primaries: 'bt2020',
      codec_tag_string: 'hvc1',
      side_data_list: [{ side_data_type: 'DOVI configuration record', dv_profile: 8 }],
    },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { duration: '100.4', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
};

const H264_SDR_PROBE: VideoProbe = {
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      pix_fmt: 'yuv420p',
      width: 1280,
      height: 720,
      color_transfer: 'bt709',
    },
  ],
  format: { duration: '12' },
};

describe('decideCompat', () => {
  it('flags the iPhone Dolby Vision HLG recording and tone-maps HLG', () => {
    const d = decideCompat(IPHONE_DV_PROBE);
    expect(d.needed).toBe(true);
    expect(d.reasons).toEqual(['codec', 'bit_depth', 'hdr', 'dolby_vision']);
    expect(d.hdrTransfer).toBe('arib-std-b67');
    expect(d.source.dolbyVision).toBe(true);
    expect(d.source.bitDepth).toBe(10);
    expect(d.source.durationSeconds).toBeCloseTo(100.4);
  });

  it('leaves already-compatible H.264 8-bit SDR alone', () => {
    const d = decideCompat(H264_SDR_PROBE);
    expect(d.needed).toBe(false);
    expect(d.reasons).toEqual([]);
  });

  it('flags plain 8-bit HEVC SDR (codec only) without tone-mapping', () => {
    const d = decideCompat({
      streams: [
        { codec_type: 'video', codec_name: 'hevc', pix_fmt: 'yuv420p', width: 1920, height: 1080 },
      ],
    });
    expect(d.reasons).toEqual(['codec']);
    expect(d.hdrTransfer).toBeNull();
  });

  it('flags 4K H.264 for resolution and PQ for hdr', () => {
    expect(
      decideCompat({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            pix_fmt: 'yuv420p',
            width: 3840,
            height: 2160,
          },
        ],
      }).reasons
    ).toEqual(['resolution']);
    const pq = decideCompat({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          pix_fmt: 'yuv420p',
          color_transfer: 'smpte2084',
        },
      ],
    });
    expect(pq.hdrTransfer).toBe('smpte2084');
  });

  it('detects Dolby Vision from the dvh1 sample entry', () => {
    expect(
      decideCompat({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'hevc',
            pix_fmt: 'yuv420p10le',
            codec_tag_string: 'dvh1',
          },
        ],
      }).source.dolbyVision
    ).toBe(true);
  });

  it('does not need a rendition for audio-only files', () => {
    expect(decideCompat({ streams: [{ codec_type: 'audio', codec_name: 'aac' }] }).needed).toBe(
      false
    );
  });
});

describe('buildCompatTranscodeArgs', () => {
  it('restricts ffmpeg to local files and emits H.264 8-bit SDR faststart MP4', () => {
    const args = buildCompatTranscodeArgs('/tmp/in', '/tmp/out.mp4', 'arib-std-b67');
    expect(args.slice(0, 5)).toEqual(['-nostdin', '-y', '-protocol_whitelist', 'file', '-i']);
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toContain('zscale=tin=arib-std-b67');
    expect(vf).toContain('tonemap=tonemap=hable');
    expect(args).toEqual(expect.arrayContaining(['libx264', 'yuv420p', '+faststart', 'aac']));
    expect(args[args.length - 1]).toBe('/tmp/out.mp4');
  });

  it('skips tone-mapping for SDR sources', () => {
    const args = buildCompatTranscodeArgs('/tmp/in', '/tmp/out.mp4', null);
    expect(args[args.indexOf('-vf') + 1]).not.toContain('tonemap');
  });
});

describe('status + helpers', () => {
  it('treats ready/not_needed/skipped as terminal and retries old failures', () => {
    const now = 10 * FAILED_RETRY_AFTER_MS;
    expect(isTerminalStatus(null, now)).toBe(false);
    expect(isTerminalStatus({ status: 'ready', at: 0 }, now)).toBe(true);
    expect(isTerminalStatus({ status: 'failed', at: now - 1000 }, now)).toBe(true);
    expect(isTerminalStatus({ status: 'failed', at: now - FAILED_RETRY_AFTER_MS - 1 }, now)).toBe(
      false
    );
  });

  it('bounds the transcode timeout', () => {
    expect(transcodeTimeoutMs(10)).toBe(2 * 60_000);
    expect(transcodeTimeoutMs(100.4)).toBeGreaterThanOrEqual(2 * 60_000);
    expect(transcodeTimeoutMs(10_000)).toBe(30 * 60_000);
  });
});
