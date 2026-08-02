import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Session } from "@xyne/kata-sdk";
import type { ToolExecutionContext } from "../types.js";
import {
  buildSandboxStoreKey,
  getSandboxSession,
  REPO_CONFIGS,
} from "../sandbox/index.js";
import { generateSceneHtml } from "./scene-html.js";
import type { Renderer, Storyboard, Theme, VideoScene } from "./storyboard.js";

const WORK_DIR = "/home/nixuser/workspace/.video-explainer";
export const OUTPUT_PATH = "/home/nixuser/workspace/results/explainer.mp4";
const AUTH_URL_DEFAULT = "http://xyne-claw-auth.xyne-apps.svc.cluster.local:3003";

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
 * Builds the per-segment ffmpeg -vf chain. "slides" (default) keeps the exact
 * static-still behavior and applies NO video filter. "motion" adds a slow Ken
 * Burns push-in (1.0 -> ~1.08 across the whole segment) plus a 0.4s fade in/out,
 * so each scene reads as a subtle camera move instead of a frozen frame. Uses
 * only ffmpeg already in the image.
 */
function segmentFilter(renderer: Renderer, segmentSeconds: number): string {
  if (renderer !== "motion") return "";
  const fps = 30;
  const frames = Math.max(1, Math.round(segmentSeconds * fps));
  const zoomTarget = 1.08;
  const increment = ((zoomTarget - 1) / frames).toFixed(6);
  const zoompan =
    `zoompan=z='min(zoom+${increment}\,${zoomTarget})':d=${frames}:` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=${fps}`;
  const filters = [zoompan];
  const fadeDur = 0.4;
  if (segmentSeconds > fadeDur * 3) {
    filters.push(`fade=t=in:st=0:d=${fadeDur}`);
    filters.push(`fade=t=out:st=${(segmentSeconds - fadeDur).toFixed(3)}:d=${fadeDur}`);
  }
  return filters.join(",");
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

async function shipMermaidRuntime(session: Session): Promise<boolean> {
  const bundle = mermaidRuntime();
  if (!bundle) return false;
  await session.files.write(`${WORK_DIR}/mermaid.min.js`, bundle);
  return true;
}

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
): Promise<void> {
  const options: { code?: string; mermaidLive?: boolean; theme?: Theme } = {};
  if (scene.kind === "code") options.code = await sceneCode(session, context, scene);
  if (scene.kind === "diagram" && mermaidShipped) options.mermaidLive = true;
  options.theme = storyboard.theme;
  const html = generateSceneHtml(
    storyboard.title,
    scene,
    index + 1,
    storyboard.scenes.length,
    options,
  );
  const htmlPath = `${WORK_DIR}/scene-${index}.html`;
  const pngPath = `${WORK_DIR}/scene-${index}.png`;
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

export async function composeVideo(
  session: Session,
  context: ToolExecutionContext,
  storyboard: Storyboard,
): Promise<SceneTiming[]> {
  await run(
    session,
    `if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then ` +
      `echo "ffmpeg/ffprobe missing: rebuild agent-workspace-golden with the ffmpeg prebake package" >&2; exit 43; fi; ` +
      `mkdir -p '${WORK_DIR}' "$(dirname '${OUTPUT_PATH}')"`,
  );

  const renderer = storyboard.renderer;
  const hasDiagram = storyboard.scenes.some((scene) => scene.kind === "diagram");
  const mermaidShipped = hasDiagram ? await shipMermaidRuntime(session) : false;

  const timings: SceneTiming[] = [];
  for (const [index, scene] of storyboard.scenes.entries()) {
    await renderScene(session, context, storyboard, scene, index, mermaidShipped);
    const audioPath = `${WORK_DIR}/scene-${index}.mp3`;
    await session.files.write(
      audioPath,
      await requestNarration(context, scene.narration, storyboard.voice),
    );
    const durationOutput = await run(
      session,
      `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 '${audioPath}'`,
      30_000,
    );
    const narrationSeconds = Number.parseFloat(durationOutput);
    if (!Number.isFinite(narrationSeconds) || narrationSeconds <= 0) {
      throw new Error(`ffprobe could not measure narration for scene ${index + 1}`);
    }
    const segmentSeconds = narrationSeconds + 0.8;
    const filter = segmentFilter(renderer, segmentSeconds);
    const filterArg = filter ? `-vf "${filter}" ` : "";
    await run(
      session,
      `ffmpeg -y -loop 1 -i '${WORK_DIR}/scene-${index}.png' -i '${audioPath}' ` +
        filterArg +
        `-af apad -t ${segmentSeconds.toFixed(3)} -r 30 -c:v libx264 -preset medium -pix_fmt yuv420p ` +
        `-c:a aac -b:a 192k '${WORK_DIR}/segment-${index}.mp4'`,
      120_000,
    );
    timings.push({
      scene: index + 1,
      kind: scene.kind,
      narrationSeconds: Number(narrationSeconds.toFixed(2)),
      segmentSeconds: Number(segmentSeconds.toFixed(2)),
    });
  }

  const concat = storyboard.scenes
    .map((_, index) => `file '${WORK_DIR}/segment-${index}.mp4'`)
    .join("\n");
  await session.files.write(`${WORK_DIR}/concat.txt`, Buffer.from(`${concat}\n`));
  await run(
    session,
    `ffmpeg -y -f concat -safe 0 -i '${WORK_DIR}/concat.txt' -c:v libx264 -preset medium ` +
      `-pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart '${OUTPUT_PATH}'`,
    180_000,
  );
  return timings;
}
