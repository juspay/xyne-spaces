import { spawn } from 'child_process';

function runMediaCommand(command: 'ffmpeg' | 'ffprobe', args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    proc.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

export interface VideoStreamInfo {
  codec: string;
  pixelFormat: string | null;
}

export async function probeVideoStream(inputPath: string): Promise<VideoStreamInfo | null> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,pix_fmt',
      '-of',
      'json',
      inputPath,
    ];
    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const parsed = JSON.parse(stdout) as {
            streams?: Array<{ codec_name?: string; pix_fmt?: string }>;
          };
          const stream = parsed.streams?.[0];
          resolve(
            stream?.codec_name
              ? {
                  codec: stream.codec_name.toLowerCase(),
                  pixelFormat: stream.pix_fmt?.toLowerCase() || null,
                }
              : null
          );
        } catch {
          reject(new Error('ffprobe returned invalid JSON'));
        }
      } else reject(new Error(`ffprobe exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

export async function transcodeVideoToH264(inputPath: string, outputPath: string): Promise<void> {
  await runMediaCommand('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}

export async function generateVideoThumbnail(inputPath: string, outputPath: string): Promise<void> {
  await runMediaCommand('ffmpeg', [
    '-y',
    '-ss',
    '1',
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-vf',
    "scale='min(640,iw)':-2",
    '-q:v',
    '3',
    outputPath,
  ]);
}

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
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}
