import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { Session } from "@xyne/kata-sdk";
import type { ToolExecutionContext } from "../types.js";
import {
  buildSandboxStoreKey,
  getSandboxSession,
  REPO_CONFIGS,
} from "../sandbox/index.js";
import { generateSceneHtml } from "./scene-html.js";
import {
  computeSegmentSeconds,
  isAnimatedScene,
  type ManimScene,
  type D2Scene,
  type Storyboard,
  type VideoScene,
} from "./storyboard.js";

const WORK_ROOT = "/home/nixuser/workspace/.video-explainer";
const RESULTS_DIR = "/home/nixuser/workspace/results";
const AUTH_URL_DEFAULT = "http://xyne-claw-auth.xyne-apps.svc.cluster.local:3003";

// Canonical output geometry. Every scene — static screenshot, Manim clip, or
// D2 reveal — is normalized to exactly this before concatenation so the
// concat demuxer never sees a resolution/SAR/fps mismatch.
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const CANVAS = "#07111f";
// Nominal on-screen time per D2 board before the next fades in. Narration
// still governs the final segment length via computeSegmentSeconds.
const D2_STEP_SECONDS = 2.4;
const D2_FADE_SECONDS = 0.4;

interface TtsEnvelope {
  success?: boolean;
  data?: { audioBase64?: string };
  error?: string;
}

export interface SceneTiming {
  scene: number;
  kind: VideoScene["kind"];
  narrationSeconds: number;
  segmentSeconds: number;
  animationSeconds?: number;
}

export interface CompositionResult {
  outputPath: string;
  scenes: SceneTiming[];
}

function authUrl(context: ToolExecutionContext): string {
  return (
    context.config["XYNE_CLAW_AUTH_URL"] ??
    process.env["XYNE_CLAW_AUTH_URL"] ??
    AUTH_URL_DEFAULT
  ).replace(/\/+$/, "");
}

function s2sKey(context: ToolExecutionContext): string {
  return (
    context.s2sKey ??
    context.config["XYNE_CLAW_S2S_KEY"] ??
    process.env["XYNE_CLAW_S2S_KEY"] ??
    ""
  );
}

export function currentSandbox(context: ToolExecutionContext): Session | undefined {
  const storeKey = buildSandboxStoreKey(
    context.meta?.["userId"],
    context.meta?.["conversationId"],
    context.meta?.["agentSlug"],
  );
  return storeKey ? getSandboxSession(storeKey) : undefined;
}

async function run(session: Session, command: string, timeoutMs = 60_000): Promise<string> {
  const result = await session.commands.run(command, timeoutMs);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
    throw new Error(detail);
  }
  return result.stdout.trim();
}

async function probeSeconds(session: Session, mediaPath: string, label: string): Promise<number> {
  const output = await run(
    session,
    `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 '${mediaPath}'`,
    30_000,
  );
  const seconds = Number.parseFloat(output);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe could not measure ${label}`);
  }
  return seconds;
}

async function requestNarration(
  context: ToolExecutionContext,
  text: string,
  voice?: string,
): Promise<Buffer> {
  const key = s2sKey(context);
  if (!key) {
    throw new Error(
      "XYNE_CLAW_S2S_KEY is unavailable; create-video-explainer cannot authenticate to claw-auth.",
    );
  }
  const response = await fetch(`${authUrl(context)}/claw/api/v1/internal/tts`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-s2s-key": key },
    body: JSON.stringify({ text, ...(voice ? { voice } : {}) }),
    signal: AbortSignal.timeout(35_000),
  });
  let payload: TtsEnvelope;
  try {
    payload = (await response.json()) as TtsEnvelope;
  } catch {
    throw new Error(`claw-auth TTS returned an invalid response (HTTP ${response.status})`);
  }
  if (!response.ok || payload.success !== true || !payload.data?.audioBase64) {
    throw new Error(payload.error || `claw-auth TTS returned HTTP ${response.status}`);
  }
  return Buffer.from(payload.data.audioBase64, "base64");
}

/**
 * Mermaid renders in the SANDBOX's chromium during the screenshot — the same
 * browser pass that rasterizes every scene — so diagrams need no mmdc in the
 * golden image and no network. The library ships from the claw pod's own
 * node_modules into the sandbox work dir once per run.
 */
let mermaidBundle: Buffer | null | undefined;

function mermaidRuntime(): Buffer | null {
  if (mermaidBundle !== undefined) return mermaidBundle;
  try {
    const require = createRequire(import.meta.url);
    mermaidBundle = readFileSync(require.resolve("mermaid/dist/mermaid.min.js"));
  } catch {
    mermaidBundle = null;
  }
  return mermaidBundle;
}

async function shipMermaidRuntime(session: Session, workDir: string): Promise<boolean> {
  const bundle = mermaidRuntime();
  if (!bundle) return false;
  // STREAM, don't write. mermaid.min.js is ~3.3 MB, and files.write base64-encodes
  // the whole thing into ONE JSON body (~4.4 MB) — which the sandbox rejects with
  // `request entity too large`. Observed live: every storyboard containing a
  // diagram scene failed here, while title-only storyboards succeeded, because
  // this function only runs when a diagram is present. The agent then silently
  // retried with a single trivial scene rather than surfacing the 413.
  //
  // writeStream chunks through the same /write endpoint and appends server-side,
  // so no single request is large. 1 MiB keeps a wide margin under any body cap
  // in the router or workspace agent.
  await session.files.writeStream(
    `${workDir}/mermaid.min.js`,
    (async function* () { yield new Uint8Array(bundle); })(),
    { chunkBytes: 1024 * 1024 },
  );
  return true;
}

// ffmpeg filter that fits arbitrary source geometry into the canonical frame
// without cropping: letterbox onto a CANVAS-colored 1920x1080, square pixels,
// 30fps.
const FIT_FILTER =
  `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,` +
  `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=${CANVAS},setsar=1,fps=${FPS}`;

async function sceneCode(
  session: Session,
  context: ToolExecutionContext,
  scene: Extract<VideoScene, { kind: "code" }>,
): Promise<string> {
  const normalized = scene.file.replaceAll("\\", "/");
  if (
    normalized.split("/").includes("..") ||
    (normalized.startsWith("/") &&
      !normalized.startsWith("/workspace/") &&
      !normalized.startsWith("/home/nixuser/workspace/"))
  ) {
    return `// Refused to read ${scene.file}\n// Code scenes are restricted to the sandbox workspace.`;
  }
  const pinnedRepo = context.meta?.["sandboxRepo"];
  const repoRoot = pinnedRepo ? REPO_CONFIGS[pinnedRepo]?.workDir : undefined;
  const candidates = normalized.startsWith("/")
    ? [normalized]
    : [
        ...(repoRoot ? [`${repoRoot}/${normalized}`] : []),
        `/home/nixuser/workspace/${normalized}`,
        `/workspace/${normalized}`,
      ];
  for (const candidate of candidates) {
    try {
      return (await session.files.read(candidate)).toString("utf8");
    } catch {
      // Try the next workspace-relative candidate before degrading the scene.
    }
  }
  return `// Unable to read ${scene.file}\n// The video continues with a graceful placeholder.`;
}

async function renderScene(
  session: Session,
  context: ToolExecutionContext,
  storyboard: Storyboard,
  scene: VideoScene,
  index: number,
  mermaidShipped: boolean,
  workDir: string,
): Promise<void> {
  const options: { code?: string; mermaidLive?: boolean } = {};
  if (scene.kind === "code") options.code = await sceneCode(session, context, scene);
  if (scene.kind === "diagram" && mermaidShipped) options.mermaidLive = true;
  const html = generateSceneHtml(
    storyboard.title,
    scene,
    index + 1,
    storyboard.scenes.length,
    options,
  );
  const htmlPath = `${workDir}/scene-${index}.html`;
  const pngPath = `${workDir}/scene-${index}.png`;
  await session.files.write(htmlPath, Buffer.from(html));
  await run(
    session,
    `BROWSER="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"; ` +
      `if [ -z "$BROWSER" ]; then echo "Chromium is missing from the sandbox golden image" >&2; exit 42; fi; ` +
      `"$BROWSER" --headless --no-sandbox --disable-gpu --hide-scrollbars --allow-file-access-from-files ` +
      // virtual-time-budget lets in-page JS (mermaid) finish before the shot.
      `--virtual-time-budget=8000 --window-size=1920,1080 --screenshot='${pngPath}' 'file://${htmlPath}'`,
    30_000,
  );
}

/**
 * Render a Manim scene, in THIS sandbox, to a silent clip normalized to the
 * canonical frame. `source` is written to a file (never shelled); only the
 * validated `scene` identifier is interpolated into the command line.
 */
async function renderManim(
  session: Session,
  scene: ManimScene,
  index: number,
  workDir: string,
): Promise<string> {
  const scriptPath = `${workDir}/manim-${index}.py`;
  const mediaDir = `${workDir}/manim-${index}-media`;
  const outPath = `${workDir}/anim-${index}.mp4`;
  await session.files.write(scriptPath, Buffer.from(scene.source));
  await run(
    session,
    `command -v manim >/dev/null 2>&1 || { echo "manim is missing from the studio image" >&2; exit 44; }; ` +
      `cd '${workDir}' && manim --renderer=cairo -r ${WIDTH},${HEIGHT} --fps ${FPS} ` +
      `--media_dir '${mediaDir}' -o out --format mp4 '${scriptPath}' ${scene.scene}`,
    600_000,
  );
  const raw = await run(
    session,
    `find '${mediaDir}' -type f -name 'out.mp4' -print -quit`,
  );
  if (!raw) throw new Error(`manim produced no output for scene ${index + 1}`);
  await run(
    session,
    `ffmpeg -y -i '${raw}' -vf "${FIT_FILTER}" -an -pix_fmt yuv420p '${outPath}'`,
    180_000,
  );
  return outPath;
}

/**
 * Render an ordered set of D2 boards to a silent progressive-reveal clip,
 * entirely offline: d2 (layout+SVG) → rsvg-convert (raster) → ffmpeg. No
 * headless browser and no network, so it runs in the sealed studio image.
 */
export function buildD2TransitionPlan(stepCount: number): {
  filterComplex: string;
  durationSeconds: number;
  outputLabel: string;
} {
  if (!Number.isInteger(stepCount) || stepCount < 1 || stepCount > 8) {
    throw new Error("D2 transition step count must be between 1 and 8");
  }

  const filters: string[] = [];
  for (let step = 0; step < stepCount; step += 1) {
    filters.push(
      `[${step}:v]${FIT_FILTER},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS` +
        `${step === 0 ? `,fade=t=in:st=0:d=${D2_FADE_SECONDS}` : ""}[board${step}]`,
    );
  }

  let outputLabel = "board0";
  for (let step = 1; step < stepCount; step += 1) {
    const nextLabel = `reveal${step}`;
    const offset = step * (D2_STEP_SECONDS - D2_FADE_SECONDS);
    filters.push(
      `[${outputLabel}][board${step}]xfade=transition=fade:duration=${D2_FADE_SECONDS}:` +
        `offset=${offset.toFixed(3)}[${nextLabel}]`,
    );
    outputLabel = nextLabel;
  }

  return {
    filterComplex: filters.join(";"),
    durationSeconds:
      stepCount * D2_STEP_SECONDS - (stepCount - 1) * D2_FADE_SECONDS,
    outputLabel,
  };
}

async function renderD2(
  session: Session,
  scene: D2Scene,
  index: number,
  workDir: string,
): Promise<string> {
  const pngPaths: string[] = [];
  for (const [step, source] of scene.steps.entries()) {
    const d2Path = `${workDir}/d2-${index}-${step}.d2`;
    const svgPath = `${workDir}/d2-${index}-${step}.svg`;
    const pngPath = `${workDir}/d2-${index}-${step}.png`;
    await session.files.write(d2Path, Buffer.from(source));
    await run(
      session,
      `command -v d2 >/dev/null 2>&1 || { echo "d2 is missing from the studio image" >&2; exit 45; }; ` +
        `D2_LAYOUT=dagre d2 --pad 48 '${d2Path}' '${svgPath}'`,
      120_000,
    );
    await run(
      session,
      `command -v rsvg-convert >/dev/null 2>&1 || { echo "rsvg-convert is missing from the studio image" >&2; exit 46; }; ` +
        `rsvg-convert -w ${WIDTH} -h ${HEIGHT} --keep-aspect-ratio -b '${CANVAS}' '${svgPath}' -o '${pngPath}'`,
      120_000,
    );
    pngPaths.push(pngPath);
  }

  const outPath = `${workDir}/anim-${index}.mp4`;
  const transition = buildD2TransitionPlan(pngPaths.length);
  const inputs = pngPaths
    .map((pngPath) => `-loop 1 -framerate ${FPS} -t ${D2_STEP_SECONDS} -i '${pngPath}'`)
    .join(" ");
  await run(
    session,
    `ffmpeg -y ${inputs} -filter_complex "${transition.filterComplex}" ` +
      `-map "[${transition.outputLabel}]" -t ${transition.durationSeconds.toFixed(3)} -an ` +
      `-r ${FPS} -c:v libx264 -preset medium -pix_fmt yuv420p '${outPath}'`,
    180_000,
  );
  return outPath;
}

async function renderAnimation(
  session: Session,
  scene: ManimScene | D2Scene,
  index: number,
  workDir: string,
): Promise<{ clipPath: string; animationSeconds: number }> {
  const clipPath =
    scene.kind === "manim"
      ? await renderManim(session, scene, index, workDir)
      : await renderD2(session, scene, index, workDir);
  const animationSeconds = await probeSeconds(session, clipPath, `animation for scene ${index + 1}`);
  return { clipPath, animationSeconds };
}

export async function composeVideo(
  session: Session,
  context: ToolExecutionContext,
  storyboard: Storyboard,
): Promise<CompositionResult> {
  const renderId = randomUUID();
  const workDir = `${WORK_ROOT}/${renderId}`;
  const outputPath = `${RESULTS_DIR}/explainer-${renderId}.mp4`;

  try {
    await run(
      session,
      `if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then ` +
        `echo "ffmpeg/ffprobe missing: rebuild agent-workspace-golden with the ffmpeg prebake package" >&2; exit 43; fi; ` +
        `mkdir -p '${workDir}' '${RESULTS_DIR}'`,
    );

    const hasDiagram = storyboard.scenes.some((scene) => scene.kind === "diagram");
    const mermaidShipped = hasDiagram ? await shipMermaidRuntime(session, workDir) : false;

    const timings: SceneTiming[] = [];
    for (const [index, scene] of storyboard.scenes.entries()) {
      // Render the visual: a screenshot for static scenes, a silent clip for
      // animated ones. Both engines run in THIS same sandbox.
      let animationSeconds = 0;
      let clipPath: string | undefined;
      if (isAnimatedScene(scene)) {
        const animation = await renderAnimation(session, scene, index, workDir);
        clipPath = animation.clipPath;
        animationSeconds = animation.animationSeconds;
      } else {
        await renderScene(session, context, storyboard, scene, index, mermaidShipped, workDir);
      }

      // Narration is fetched by the runtime (not the sandbox) and injected as a
      // file, so the box never needs network.
      const audioPath = `${workDir}/scene-${index}.mp3`;
      await session.files.write(
        audioPath,
        await requestNarration(context, scene.narration, storyboard.voice),
      );
      const narrationSeconds = await probeSeconds(
        session,
        audioPath,
        `narration for scene ${index + 1}`,
      );

      // Narration-first: the longer of narration/animation plus a fixed tail.
      const segmentSeconds = computeSegmentSeconds(narrationSeconds, animationSeconds);

      if (clipPath) {
        // Animated: freeze the last frame to fill the segment (video never
        // truncates the voice), pad the audio with trailing silence.
        const stopDuration = Math.max(0, segmentSeconds - animationSeconds);
        await run(
          session,
          `ffmpeg -y -i '${clipPath}' -i '${audioPath}' ` +
            `-filter_complex "[0:v]tpad=stop_mode=clone:stop_duration=${stopDuration.toFixed(3)},` +
            `fps=${FPS}[v];[1:a]apad[a]" ` +
            `-map "[v]" -map "[a]" -t ${segmentSeconds.toFixed(3)} ` +
            `-c:v libx264 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k '${workDir}/segment-${index}.mp4'`,
          180_000,
        );
      } else {
        await run(
          session,
          `ffmpeg -y -loop 1 -i '${workDir}/scene-${index}.png' -i '${audioPath}' ` +
            `-af apad -t ${segmentSeconds.toFixed(3)} -r ${FPS} -c:v libx264 -preset medium -pix_fmt yuv420p ` +
            `-c:a aac -b:a 192k '${workDir}/segment-${index}.mp4'`,
          120_000,
        );
      }

      timings.push({
        scene: index + 1,
        kind: scene.kind,
        narrationSeconds: Number(narrationSeconds.toFixed(2)),
        segmentSeconds: Number(segmentSeconds.toFixed(2)),
        ...(animationSeconds > 0
          ? { animationSeconds: Number(animationSeconds.toFixed(2)) }
          : {}),
      });
    }

    const concat = storyboard.scenes
      .map((_, index) => `file '${workDir}/segment-${index}.mp4'`)
      .join("\n");
    await session.files.write(`${workDir}/concat.txt`, Buffer.from(`${concat}\n`));
    await run(
      session,
      `ffmpeg -y -f concat -safe 0 -i '${workDir}/concat.txt' -c:v libx264 -preset medium ` +
        `-pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart '${outputPath}'`,
      180_000,
    );
    return { outputPath, scenes: timings };
  } finally {
    // Keep only the uniquely named deliverable. Intermediate scripts, source,
    // audio, frames, and partial clips are removed on success and on
    // every failure path, so later renders cannot discover stale artifacts.
    await run(session, `rm -rf -- '${workDir}'`).catch(() => undefined);
  }
}
