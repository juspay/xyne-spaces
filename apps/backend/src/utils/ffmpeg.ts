import { spawn } from 'child_process';

/**
 * Remux a local HLS playlist into a single MP4. `-c copy` means no re-encode
 * (fast, lossless); `+faststart` moves the moov atom to the front for web
 * playback. Works for audio-only and A/V segments alike.
 */
export function stitchHlsToMp4(playlistPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-i', playlistPath, '-c', 'copy', '-movflags', '+faststart', outputPath];
    const proc = spawn('ffmpeg', args);

    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

/** Subset of `ffprobe -show_streams -show_format -of json` used by video renditions. */
export interface VideoProbeStream {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  width?: number;
  height?: number;
  color_transfer?: string;
  color_primaries?: string;
  color_space?: string;
  codec_tag_string?: string;
  side_data_list?: Array<{ side_data_type?: string; dv_profile?: number }>;
}

export interface VideoProbe {
  streams: VideoProbeStream[];
  format?: { duration?: string; format_name?: string };
}

interface RunOptions {
  timeoutMs: number;
}

/**
 * Run a media binary with a hard timeout. Only the tail of stderr is kept so a
 * long encode cannot grow memory without bound.
 */
function runMediaBinary(bin: 'ffmpeg' | 'ffprobe', args: string[], { timeoutMs }: RunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderrTail = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => {
      if (bin === 'ffprobe') stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new MediaTimeoutError(`${bin} timed out after ${timeoutMs}ms`));
      } else if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${bin} exited with code ${code}: ${stderrTail.slice(-2000)}`));
      }
    });
  });
}

export class MediaTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaTimeoutError';
  }
}

/** ffprobe a local file. Reads only the local filesystem (`-protocol_whitelist file`). */
export async function probeVideo(localPath: string, timeoutMs = 60_000): Promise<VideoProbe> {
  const out = await runMediaBinary(
    'ffprobe',
    [
      '-v', 'error',
      '-protocol_whitelist', 'file',
      '-show_streams',
      '-show_format',
      '-of', 'json',
      localPath,
    ],
    { timeoutMs },
  );
  return JSON.parse(out) as VideoProbe;
}

export interface CompatTranscodeOptions {
  /** Source is HDR (HLG / PQ) and must be tone-mapped to SDR BT.709. */
  hdrTransfer: 'arib-std-b67' | 'smpte2084' | null;
  timeoutMs: number;
}

/** Long edge capped at 1920; dimensions kept even for yuv420p. */
const SCALE_FILTER =
  "scale='if(gte(iw,ih),min(1920,iw),-2)':'if(gte(iw,ih),-2,min(1920,ih))'";

/**
 * The ffmpeg arguments for a universally playable rendition: H.264 High@4.1,
 * 8-bit 4:2:0 SDR BT.709, AAC, faststart. HDR sources (iPhone Dolby Vision /
 * HLG, PQ) are tone-mapped so colours are not washed out. Exported for tests.
 */
export function buildCompatTranscodeArgs(
  inputPath: string,
  outputPath: string,
  hdrTransfer: CompatTranscodeOptions['hdrTransfer'],
): string[] {
  const tonemap = hdrTransfer
    ? [
        `zscale=tin=${hdrTransfer}:pin=bt2020:min=bt2020nc:t=linear:npl=100`,
        'format=gbrpf32le',
        'zscale=p=bt709',
        'tonemap=tonemap=hable:desat=0',
        'zscale=t=bt709:m=bt709:r=tv',
      ]
    : [];
  const vf = [...tonemap, 'format=yuv420p', SCALE_FILTER].join(',');
  return [
    '-nostdin', '-y',
    '-protocol_whitelist', 'file',
    '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-threads', '2',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart',
    '-f', 'mp4',
    outputPath,
  ];
}

export async function transcodeToCompatMp4(
  inputPath: string,
  outputPath: string,
  { hdrTransfer, timeoutMs }: CompatTranscodeOptions,
): Promise<void> {
  await runMediaBinary('ffmpeg', buildCompatTranscodeArgs(inputPath, outputPath, hdrTransfer), {
    timeoutMs,
  });
}
