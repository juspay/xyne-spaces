import type { VideoProbe } from '@/utils/ffmpeg';

/**
 * Pure policy for compatible video renditions (no I/O, no config) so it can be
 * unit-tested in isolation. See videoRenditionService for the pipeline.
 */

export const CACHE_PREFIX = 'video-rendition-cache/v1';
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
export const MAX_SOURCE_DURATION_SECONDS = 30 * 60;
const MAX_LONG_EDGE = 1920;
const MIN_TRANSCODE_TIMEOUT_MS = 2 * 60_000;
const MAX_TRANSCODE_TIMEOUT_MS = 30 * 60_000;
/** A failed generation may be retried after this long (covers transient infra failures). */
export const FAILED_RETRY_AFTER_MS = 6 * 60 * 60_000;

export type CompatReason = 'codec' | 'bit_depth' | 'hdr' | 'dolby_vision' | 'resolution';

export type VideoRenditionStatus = 'ready' | 'not_needed' | 'skipped' | 'failed';

export interface CompatSourceInfo {
  codec: string | null;
  profile: string | null;
  pixFmt: string | null;
  bitDepth: number | null;
  transfer: string | null;
  dolbyVision: boolean;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export interface VideoRenditionStatusRecord {
  v: 1;
  status: VideoRenditionStatus;
  reasons: CompatReason[];
  source?: CompatSourceInfo;
  outputBytes?: number;
  error?: string;
  at: number;
}

export interface CompatDecision {
  needed: boolean;
  reasons: CompatReason[];
  hdrTransfer: 'arib-std-b67' | 'smpte2084' | null;
  source: CompatSourceInfo;
}

export type VideoRenditionLookup =
  | { state: 'ready'; path: string; size: number }
  | { state: 'pending' }
  | { state: 'not_needed' }
  | { state: 'skipped' }
  | { state: 'failed' };

export const compatPath = (base: string): string => `${base}/compat.mp4`;
export const statusPath = (base: string): string => `${base}/status.json`;

function bitDepthOf(stream: VideoProbe['streams'][number]): number | null {
  const raw = Number(stream.bits_per_raw_sample);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const fmt = stream.pix_fmt ?? '';
  const match = /p(9|10|12|14|16)(le|be)?$/.exec(fmt);
  if (match) return Number(match[1]);
  return fmt ? 8 : null;
}

/**
 * Decide whether a video needs a compatible rendition. Pure — unit tested.
 * Anything that is not already H.264 8-bit 4:2:0 SDR ≤1080p gets one: that
 * covers Dolby Vision, HLG/PQ HDR, 10-bit and plain HEVC (unsupported on many
 * low-end Android decoders and on Chrome/Firefox without platform HEVC).
 */
export function decideCompat(probe: VideoProbe): CompatDecision {
  const video = probe.streams.find((s) => s.codec_type === 'video');
  const duration = Number(probe.format?.duration);
  const source: CompatSourceInfo = {
    codec: video?.codec_name ?? null,
    profile: video?.profile ?? null,
    pixFmt: video?.pix_fmt ?? null,
    bitDepth: video ? bitDepthOf(video) : null,
    transfer: video?.color_transfer ?? null,
    dolbyVision: Boolean(
      video?.side_data_list?.some((d) => /dovi/i.test(d.side_data_type ?? '')) ||
      /^dv(h1|he|a1|av)$/i.test(video?.codec_tag_string ?? '')
    ),
    width: video?.width ?? null,
    height: video?.height ?? null,
    durationSeconds: Number.isFinite(duration) ? duration : null,
  };

  if (!video) {
    return { needed: false, reasons: [], hdrTransfer: null, source };
  }

  const reasons: CompatReason[] = [];
  if (source.codec !== 'h264') reasons.push('codec');
  if ((source.bitDepth ?? 8) > 8 || !/^yuvj?420p$/.test(source.pixFmt ?? 'yuv420p')) {
    reasons.push('bit_depth');
  }
  const hdrTransfer =
    source.transfer === 'arib-std-b67' || source.transfer === 'smpte2084' ? source.transfer : null;
  if (hdrTransfer) reasons.push('hdr');
  if (source.dolbyVision) reasons.push('dolby_vision');
  if (Math.max(source.width ?? 0, source.height ?? 0) > MAX_LONG_EDGE) reasons.push('resolution');

  return { needed: reasons.length > 0, reasons, hdrTransfer, source };
}

/** A record is terminal unless it is a failure old enough to retry. */
export function isTerminalStatus(
  record: Pick<VideoRenditionStatusRecord, 'status' | 'at'> | null,
  nowMs: number = Date.now()
): boolean {
  if (!record) return false;
  if (record.status !== 'failed') return true;
  return nowMs - record.at < FAILED_RETRY_AFTER_MS;
}

export function transcodeTimeoutMs(durationSeconds: number | null): number {
  const estimate = (durationSeconds ?? 300) * 4 * 1000;
  return Math.min(MAX_TRANSCODE_TIMEOUT_MS, Math.max(MIN_TRANSCODE_TIMEOUT_MS, estimate));
}

export function isVideoMimetype(mimetype: string | null | undefined): boolean {
  return typeof mimetype === 'string' && mimetype.toLowerCase().startsWith('video/');
}
