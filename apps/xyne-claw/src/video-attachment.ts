/**
 * Video attachment decoder — deterministic, server-side, runs at ingest
 * BEFORE the agent's model loop starts (same stage as pdf/xlsx extraction).
 *
 * Why this is NOT a tool/skill: if the agent had to extract frames itself,
 * it would burn its whole turn on ffmpeg plumbing and report "done" without
 * doing the actual task. Preprocessing here means the agent wakes up with a
 * ready-made textual narrative on disk (`.context/<name>.video.md`) plus a
 * few keyframes already in its opening context.
 *
 * Pipeline:
 *   1. ffmpeg scene-change detection extracts frames (only where the picture
 *      visibly changed), hard-capped at MAX_FRAMES. Falls back to even
 *      sampling if scene-detect yields too few (static screen-recordings).
 *   2. Rolling-state loop: window the frames, and for each window feed
 *      `prior textual state + this window's frames` to a vision model,
 *      getting back an UPDATED state. We carry forward TEXT, not images —
 *      so a 30-min clip collapses to a few KB of running narrative instead
 *      of thousands of frames blowing the context window.
 *   3. Return the final narrative + a spread of keyframes (as ImageContent)
 *      so the agent can both read the summary and look at key moments.
 *
 * Models only accept `["text","image"]` (see agent.ts model registry) — a
 * raw .mov can never go to the LLM, which is the entire reason this exists.
 *
 * Never throws: a corrupt/unreadable video produces an error-stub narrative
 * and zero keyframes, so one bad attachment doesn't abort the whole run.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LITELLM } from "./config.js";
import { matchesAttachmentType, VIDEO_ATTACHMENT, VIDEO_MIME_PREFIX } from "xyne-claw-shared";

import { createLogger } from "./logger.js";
const log = createLogger("video-attachment");

const execFileAsync = promisify(execFile);

// Caps. Tuned for "scene-detect, ~30 frame" sampling. A typical few-minute
// clip yields 10-30 scene-change frames; long videos get sampled down.
const MAX_FRAMES = 30;
const FRAMES_PER_WINDOW = 6;        // images per rolling-state model call
const KEYFRAMES_TO_RETURN = 5;      // spread across the video for the opening prompt
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB — bigger gets the error stub
const MAX_NARRATIVE_CHARS = 12_000; // final narrative cap (footer appended if hit)
const FFMPEG_TIMEOUT_MS = 120_000;  // 2 min per ffmpeg invocation
const MODEL_TIMEOUT_MS = 60_000;    // per rolling-state model call

export { VIDEO_MIME_PREFIX };
export const VIDEO_EXTENSIONS = VIDEO_ATTACHMENT.extensions;

export function isVideoAttachment(fileName: string, mimeType?: string | null): boolean {
  return matchesAttachmentType(fileName, mimeType, VIDEO_ATTACHMENT.mimeTypes, VIDEO_ATTACHMENT.extensions);
}

export interface VideoKeyframe {
  data: string;       // base64 PNG
  mimeType: string;   // "image/png"
}

export interface VideoContextResult {
  /** Markdown narrative for `.context/<name>.video.md`. */
  narrative: string;
  /** Spread of frames for the opening prompt (may be empty on failure). */
  keyframes: VideoKeyframe[];
}

/** Build an error-stub result so a bad video never aborts the run. */
function errorStub(fileName: string, reason: string): VideoContextResult {
  return {
    narrative:
      `# Video: ${fileName}\n\n` +
      `> ⚠️ Could not process this video: ${reason}\n` +
      `> The agent should ask the user to re-share or describe the video instead.\n`,
    keyframes: [],
  };
}

/**
 * Extract scene-change frames from a video file into `outDir`. Returns the
 * sorted list of produced PNG paths. Falls back to even-interval sampling
 * when scene detection yields fewer than 3 frames (static screen-recordings
 * trip scene-detect because nothing "changes" enough).
 */
async function extractFrames(inputPath: string, outDir: string): Promise<string[]> {
  // Scene-change pass: emit a frame whenever inter-frame difference > 0.3.
  // -vsync vfr keeps only the selected frames; scale caps the longest side
  // at 768px so each frame stays a reasonable token cost (~1-1.5k tokens).
  const sceneArgs = [
    "-hide_banner", "-loglevel", "error",
    "-i", inputPath,
    "-vf", "select='gt(scene,0.3)',scale='min(768,iw)':-2",
    "-vsync", "vfr",
    "-frames:v", String(MAX_FRAMES),
    join(outDir, "scene_%04d.png"),
  ];
  await execFileAsync("ffmpeg", sceneArgs, { timeout: FFMPEG_TIMEOUT_MS }).catch((e) => {
    // Surface the real reason instead of swallowing it. ENOENT = ffmpeg not
    // in the image (Dockerfile change not rebuilt); other = codec/filter
    // failure. Without this the failure looked like "0 frames" with no cause.
    const code = (e as { code?: string })?.code;
    log.warn(`[video] ffmpeg scene-detect failed (code=${code ?? "?"}): ${(e as Error)?.message?.slice(0, 200)}`);
  });

  let frames = (await readdir(outDir).catch(() => []))
    .filter((f) => f.startsWith("scene_") && f.endsWith(".png"))
    .sort()
    .map((f) => join(outDir, f));

  log.info(`[video] scene-detect produced ${frames.length} frame(s)`);
  if (frames.length >= 3) return frames.slice(0, MAX_FRAMES);

  // Fallback: even sampling. Probe duration, then pick MAX_FRAMES evenly.
  // Use a simple fps filter sized so total frames ≈ MAX_FRAMES across the
  // whole clip; if duration probe fails, default to 1 frame every 3s.
  let durationSec = 0;
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", inputPath],
      { timeout: 15_000 },
    );
    durationSec = parseFloat(stdout.trim()) || 0;
  } catch { /* keep 0 */ }

  const fps = durationSec > 0 ? Math.max(MAX_FRAMES / durationSec, 1 / 5) : 1 / 3;
  const evenArgs = [
    "-hide_banner", "-loglevel", "error",
    "-i", inputPath,
    "-vf", `fps=${fps.toFixed(4)},scale='min(768,iw)':-2`,
    "-frames:v", String(MAX_FRAMES),
    join(outDir, "even_%04d.png"),
  ];
  await execFileAsync("ffmpeg", evenArgs, { timeout: FFMPEG_TIMEOUT_MS }).catch((e) => {
    const code = (e as { code?: string })?.code;
    log.warn(`[video] ffmpeg even-sample failed (code=${code ?? "?"}, durationSec=${durationSec}): ${(e as Error)?.message?.slice(0, 200)}`);
  });

  frames = (await readdir(outDir).catch(() => []))
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => join(outDir, f));
  log.info(`[video] even-sample produced ${frames.length} frame(s) (durationSec=${durationSec})`);
  return frames.slice(0, MAX_FRAMES);
}

/** One vision-model call: prior state + this window's frames → updated state. */
async function rollWindow(
  priorState: string,
  windowFrames: VideoKeyframe[],
  windowIndex: number,
  totalWindows: number,
): Promise<string> {
  const imageBlocks = windowFrames.map((f) => ({
    type: "image_url" as const,
    image_url: { url: `data:${f.mimeType};base64,${f.data}` },
  }));

  const sys =
    "You are building a running description of a video by looking at it a few frames at a time, in order. " +
    "You are given the description-so-far and the next batch of frames. " +
    "Output an UPDATED running description that incorporates the new frames: " +
    "what is on screen, what changed, any visible text/UI/actions, and the apparent purpose. " +
    "Keep it factual and chronological. Do NOT speculate beyond what's visible. " +
    "Return ONLY the updated description text — no preamble, no markdown headers.";

  const userText =
    `Description so far (window ${windowIndex}/${totalWindows}):\n` +
    `${priorState || "(nothing yet — these are the first frames)"}\n\n` +
    `Here are the next ${windowFrames.length} frame(s) in order. Update the description.`;

  const res = await fetch(`${LITELLM.url}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LITELLM.apiKey}`,
    },
    body: JSON.stringify({
      // Gateway's primary model (LITELLM_MODEL). MUST be vision-capable —
      // a text-only model silently drops the image_url blocks and the
      // narrative comes back hallucinated.
      model: LITELLM.model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: [{ type: "text", text: userText }, ...imageBlocks] },
      ],
      max_tokens: 5000,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });

  if (!res.ok) {
    // Keep the prior state on a failed window rather than aborting — partial
    // narrative beats no narrative.
    const body = await res.text().catch(() => "");
    log.warn(`[video] rollWindow ${windowIndex}/${totalWindows} failed: HTTP ${res.status} ${body.slice(0, 160)}`);
    return priorState;
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const next = json.choices?.[0]?.message?.content?.trim();
  return next && next.length > 0 ? next : priorState;
}

/** Pick `count` frames spread evenly across the list (always includes first + last). */
function pickSpread<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const out: T[] = [];
  const step = (items.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) out.push(items[Math.round(i * step)]!);
  return out;
}

/**
 * Convert a video buffer into a textual narrative + keyframes. Always
 * resolves; on any failure returns an error-stub narrative and no frames.
 */
export async function videoBufferToContext(buf: Buffer, fileName: string): Promise<VideoContextResult> {
  if (buf.length > MAX_VIDEO_BYTES) {
    return errorStub(fileName, `file too large (${Math.round(buf.length / 1024 / 1024)}MB > ${MAX_VIDEO_BYTES / 1024 / 1024}MB cap)`);
  }

  let workDir: string | null = null;
  try {
    workDir = await mkdtemp(join(tmpdir(), "xyne-video-"));
    // Keep the original extension so ffmpeg's demuxer auto-detects the format.
    const dot = fileName.lastIndexOf(".");
    const ext = dot >= 0 ? fileName.slice(dot) : ".mov";
    const inputPath = join(workDir, `input${ext}`);
    await writeFile(inputPath, buf);

    const framePaths = await extractFrames(inputPath, workDir);
    if (framePaths.length === 0) {
      return errorStub(fileName, "no frames could be extracted (unsupported codec or empty video)");
    }

    const frames: VideoKeyframe[] = await Promise.all(
      framePaths.map(async (p) => ({
        data: (await readFile(p)).toString("base64"),
        mimeType: "image/png",
      })),
    );

    // Rolling-state loop over windows.
    let state = "";
    const windows: VideoKeyframe[][] = [];
    for (let i = 0; i < frames.length; i += FRAMES_PER_WINDOW) {
      windows.push(frames.slice(i, i + FRAMES_PER_WINDOW));
    }
    for (let w = 0; w < windows.length; w++) {
      state = await rollWindow(state, windows[w]!, w + 1, windows.length);
    }

    let narrativeBody = state.trim() || "(the model produced no description — the video may have no discernible content)";
    let truncated = false;
    if (narrativeBody.length > MAX_NARRATIVE_CHARS) {
      narrativeBody = narrativeBody.slice(0, MAX_NARRATIVE_CHARS);
      truncated = true;
    }

    const narrative =
      `# Video: ${fileName}\n\n` +
      `> Auto-generated description from ${frames.length} sampled frame(s) across the clip.\n` +
      `> Reconstructed by looking at the video a few frames at a time — treat as a faithful but lossy summary.\n\n` +
      `${narrativeBody}\n` +
      (truncated ? `\n> _(description truncated at ${MAX_NARRATIVE_CHARS} chars)_\n` : "");

    return { narrative, keyframes: pickSpread(frames, KEYFRAMES_TO_RETURN) };
  } catch (err) {
    return errorStub(fileName, err instanceof Error ? err.message : String(err));
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
