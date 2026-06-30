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
