import { Buffer } from "node:buffer";
import type { Session } from "@xyne/kata-sdk";
import type { ToolDefinition, ToolExecutionContext } from "../types.js";
import {
  buildSandboxStoreKey,
  forgetSandboxSession,
  getSandboxSession,
  getSandboxTemplate,
  makeRepoSetupTool,
  SANDBOX_CONFIG_SCHEMA,
} from "../sandbox/index.js";
import { REPO_CONFIGS } from "../sandbox/repo-configs.js";

const TEMPLATE = "xyne-lens-local-template";
const ROOT = "/workspace/xyne-lens";
const SOURCE_ROOT = `${ROOT}/src`;
const RESULTS_ROOT = `${ROOT}/results`;
const OUTPUT_PATH = `${RESULTS_ROOT}/xyne-lens.mp4`;
const PREVIEW_PATH = `${RESULTS_ROOT}/preview.png`;
const WIDTH = 854;
const HEIGHT = 480;
const FPS = 30;
// Delivery currently carries the MP4 as base64 through the agent callback.
// Keep this in sync with the 160 MiB callback JSON limit in xyne-claw-auth:
// a 100 MiB binary expands to roughly 133 MiB before JSON overhead.
const MAX_DELIVERY_BYTES = 100 * 1024 * 1024;

interface LensCommandResult { stdout: string; stderr: string; exitCode: number }
interface LensSession {
  id: string;
  commands: { run(cmd: string, timeoutMs?: number): Promise<LensCommandResult> };
  files: { write(path: string, content: string | Buffer): Promise<void>; read(path: string): Promise<Buffer> };
  destroy(): Promise<void>;
}

// Keep Kata configuration available for a future Linux/Kubernetes deployment,
// but make the explicit local Docker workspace the default for this Mac-only
// development path. The local URL is restricted to loopback/Docker Desktop.
const XYNE_LENS_CONFIG_SCHEMA = {
  ...SANDBOX_CONFIG_SCHEMA,
  KATA_ROUTER_URL: { ...SANDBOX_CONFIG_SCHEMA.KATA_ROUTER_URL, required: false as const },
  XYNE_LENS_LOCAL_URL: {
    label: "Xyne Lens local workspace URL",
    default: "http://127.0.0.1:8888",
    required: false as const,
    placeholder: "http://127.0.0.1:8888 (set 'off' to use Kata)",
  },
};

const LOCAL_SESSIONS = new Map<string, LocalLensSession>();

function localWorkspaceUrl(context: ToolExecutionContext): string | null {
  const raw = (context.config["XYNE_LENS_LOCAL_URL"] ?? "").trim();
  if (!raw || raw.toLowerCase() === "off") return null;
  try {
    const url = new URL(raw);
    const allowedHosts = new Set(["127.0.0.1", "localhost", "host.docker.internal"]);
    if (url.protocol !== "http:" || !allowedHosts.has(url.hostname) || url.pathname !== "/") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

class LocalLensSession implements LensSession {
  readonly id = "xyne-lens-local-docker";

  constructor(private readonly baseUrl: string) {}

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) throw new Error(`Local Xyne Lens workspace ${response.status}: ${(await response.text()).slice(0, 500)}`);
    return response;
  }

  readonly commands = {
    run: async (cmd: string, timeoutMs = 60_000): Promise<LensCommandResult> => {
      const response = await this.request("/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.json() as { stdout?: unknown; stderr?: unknown; exit_code?: unknown };
      return {
        stdout: typeof body.stdout === "string" ? body.stdout : "",
        stderr: typeof body.stderr === "string" ? body.stderr : "",
        exitCode: typeof body.exit_code === "number" ? body.exit_code : 1,
      };
    },
  };

  readonly files = {
    write: async (path: string, content: string | Buffer): Promise<void> => {
      const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
      await this.request("/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content: data.toString("base64"), encoding: "base64" }),
      });
    },
    read: async (path: string): Promise<Buffer> => {
      const response = await this.request(`/read?path=${encodeURIComponent(path)}`, { method: "GET" });
      const body = await response.json() as { content?: unknown; encoding?: unknown };
      if (typeof body.content !== "string" || body.encoding !== "base64") throw new Error("Local workspace returned an invalid file response.");
      return Buffer.from(body.content, "base64");
    },
  };

  async ready(): Promise<void> {
    await this.request("/", { method: "GET" });
  }

  // The developer owns the Docker container lifetime. Clean only Lens files
  // after delivery so the next job starts fresh without stopping shared local
  // development infrastructure.
  async destroy(): Promise<void> {
    await this.commands.run(`rm -rf ${SOURCE_ROOT} ${RESULTS_ROOT} ${ROOT}/build && mkdir -p ${SOURCE_ROOT} ${RESULTS_ROOT} ${ROOT}/build`, 30_000);
  }
}

function storeKeyFor(context: ToolExecutionContext): string | undefined {
  return buildSandboxStoreKey(context.meta?.["userId"], context.meta?.["conversationId"], context.meta?.["agentSlug"]);
}

function activeLensSession(
  params: Record<string, unknown>,
  context: ToolExecutionContext,
): { session: LensSession; storeKey: string; local: boolean } | { error: string } {
  const storeKey = storeKeyFor(context);
  if (!storeKey) return { error: "Error: no sandbox conversation context is available." };
  const local = LOCAL_SESSIONS.get(storeKey);
  const session = local ?? getSandboxSession(storeKey);
  if (!session) return { error: "Error: no Xyne Lens sandbox is active. Call xyne-lens-setup first." };
  const requestedId = params["sessionId"] as string | undefined;
  if (requestedId && requestedId !== session.id) return { error: "Error: sessionId is not the active Xyne Lens sandbox." };
  if (!local && getSandboxTemplate(storeKey) !== TEMPLATE) {
    return { error: "Error: refusing to use a non-Xyne-Lens sandbox. Call xyne-lens-setup to get a dedicated renderer." };
  }
  return { session, storeKey, local: !!local };
}

/**
 * Resolve a model-supplied Lens path into its one canonical sandbox location.
 *
 * The agent should never need to know the container mount point. Bare paths
 * and `src/...` both mean a source file; preview/result names map to results
 * when read. Absolute paths remain accepted only as backwards compatibility
 * when they are already inside the appropriate Lens root.
 */
function normalizedPathInput(path: unknown): string | null {
  if (typeof path !== "string") return null;
  let normalized = path.trim().replaceAll("\\", "/");
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (!normalized || normalized.includes("\0") || /[^A-Za-z0-9_./-]/.test(normalized)) return null;
  // Absolute paths are checked against a Lens root by the caller. Preserve
  // them here for backwards compatibility with earlier skill instructions.
  if (normalized.startsWith("/")) return normalized;
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return normalized;
}

function pathInsideRoot(path: string, root: string): boolean {
  return path.startsWith(`${root}/`) && !path.slice(root.length + 1).split("/").some((segment) => segment === ".." || !segment);
}

function sourcePath(path: unknown): string | null {
  const normalized = normalizedPathInput(path);
  if (!normalized) return null;
  if (normalized.startsWith("/")) return pathInsideRoot(normalized, SOURCE_ROOT) ? normalized : null;
  const relative = normalized.startsWith("src/") ? normalized.slice("src/".length) : normalized;
  return relative ? `${SOURCE_ROOT}/${relative}` : null;
}

function readableLensPath(path: unknown): string | null {
  const normalized = normalizedPathInput(path);
  if (!normalized) return null;
  if (normalized.startsWith("/")) return pathInsideRoot(normalized, ROOT) ? normalized : null;
  if (normalized.startsWith("src/")) return `${ROOT}/${normalized}`;
  if (normalized.startsWith("results/") || normalized === "preview.png" || normalized === "xyne-lens.mp4") {
    return normalized.startsWith("results/") ? `${ROOT}/${normalized}` : `${RESULTS_ROOT}/${normalized}`;
  }
  if (normalized.startsWith("build/")) return `${ROOT}/${normalized}`;
  return `${SOURCE_ROOT}/${normalized}`;
}

function safeSourcePath(path: unknown): string | null {
  const normalized = sourcePath(path);
  return normalized?.endsWith(".py") ? normalized : null;
}

function parentDirectory(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

async function ensureLensParent(session: LensSession, path: string): Promise<void> {
  const result = await session.commands.run(`mkdir -p ${parentDirectory(path)}`, 30_000);
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout || "failed to create parent directory");
}

function safeSceneName(scene: unknown): string | null {
  return typeof scene === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(scene) ? scene : null;
}

function frameTimestampSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function framePathForTimestamp(timestampSeconds: number): string {
  return `${RESULTS_ROOT}/frame-${Math.round(timestampSeconds * 1000)}ms.png`;
}

async function probeMedia(session: LensSession): Promise<{ bytes: number; durationSeconds: number } | { error: string }> {
  const result = await session.commands.run(
    `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt -show_entries format=duration,size -of json ${OUTPUT_PATH}`,
    30_000,
  );
  if (result.exitCode !== 0) return { error: `ffprobe failed: ${result.stderr || result.stdout}` };
  try {
    const data = JSON.parse(result.stdout) as {
      streams?: Array<{ codec_name?: string; width?: number; height?: number; r_frame_rate?: string; pix_fmt?: string }>;
      format?: { duration?: string; size?: string };
    };
    const stream = data.streams?.[0];
    const frameRate = stream?.r_frame_rate;
    const is30fps = frameRate === "30/1" || frameRate === "30000/1001";
    if (!stream || stream.codec_name !== "h264" || stream.width !== WIDTH || stream.height !== HEIGHT || !is30fps || stream.pix_fmt !== "yuv420p") {
      return { error: `Output must be H.264/yuv420p ${WIDTH}x${HEIGHT} at ${FPS}fps; received ${stream?.codec_name ?? "unknown"}/${stream?.pix_fmt ?? "unknown"} ${stream?.width ?? "?"}x${stream?.height ?? "?"} at ${frameRate ?? "?"}.` };
    }
    const bytes = Number(data.format?.size ?? "0");
    const durationSeconds = Number(data.format?.duration ?? "0");
    if (!Number.isFinite(bytes) || bytes < 1 || bytes > MAX_DELIVERY_BYTES) return { error: `Output is ${bytes} bytes; Xyne Lens delivery limit is ${MAX_DELIVERY_BYTES} bytes.` };
    return { bytes, durationSeconds: Number(durationSeconds.toFixed(2)) };
  } catch {
    return { error: "ffprobe returned invalid metadata." };
  }
}

const baseSetup = makeRepoSetupTool(REPO_CONFIGS["xyne-lens-local"]!);

export const xyneLensSetup: ToolDefinition = {
  slug: "xyne-lens-setup",
  name: "Xyne Lens Setup",
  description: "Start a credential-free Xyne Lens session. Local development connects only to the loopback Docker workspace; set XYNE_LENS_LOCAL_URL=off to use the dedicated Kata template.",
  source: "custom:sandbox",
  configSchema: XYNE_LENS_CONFIG_SCHEMA,
  inputSchema: { type: "object", properties: {} },
  async execute(params, context) {
    if (!context) return "Error: no execution context available.";
    const localUrl = localWorkspaceUrl(context);
    if (!localUrl) return baseSetup.execute(params, context);
    const storeKey = storeKeyFor(context);
    if (!storeKey) return "Error: no sandbox conversation context is available.";
    try {
      const session = new LocalLensSession(localUrl);
      await session.ready();
      await session.destroy();
      LOCAL_SESSIONS.set(storeKey, session);
      return JSON.stringify({ sessionId: session.id, status: "ready", runtime: "docker-local", workspaceUrl: localUrl });
    } catch (error) {
      return `Error: local Xyne Lens workspace is unavailable at ${localUrl}: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const xyneLensWriteFile: ToolDefinition = {
  slug: "xyne-lens-write-file",
  name: "Xyne Lens Write File",
  description: "Write a source or asset file in the active Xyne Lens session. Use a relative name such as `gravity.py` or `assets/logo.svg`; `src/` is optional and parent folders are created automatically.",
  source: "custom:sandbox",
  configSchema: XYNE_LENS_CONFIG_SCHEMA,
  inputSchema: { type: "object", properties: { sessionId: { type: "string" }, path: { type: "string" }, content: { type: "string" }, encoding: { type: "string", enum: ["utf8", "base64"] } }, required: ["sessionId", "path", "content"] },
  async execute(params, context) {
    if (!context) return "Error: no execution context available.";
    const active = activeLensSession(params, context);
    if ("error" in active) return active.error;
    const path = sourcePath(params["path"]);
    if (!path) return "Error: path must be a safe relative file name (for example `gravity.py` or `assets/logo.svg`).";
    const content = params["content"];
    if (typeof content !== "string") return "Error: content must be a string.";
    try {
      const data = params["encoding"] === "base64" ? Buffer.from(content, "base64") : content;
      await ensureLensParent(active.session, path);
      await active.session.files.write(path, data);
      return JSON.stringify({ path, written: true });
    } catch (error) {
      return `Error: failed to write Xyne Lens file: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Apply exact, bounded source edits without asking the model to regenerate a
 * complete animation after every renderer error. Requiring each `oldText` to
 * occur exactly once keeps the operation deterministic and prevents a broad
 * replacement from silently changing another visual beat.
 */
export const xyneLensEditFile: ToolDefinition = {
  slug: "xyne-lens-edit-file",
  name: "Xyne Lens Edit File",
  description: "Apply one or more exact in-place replacements to an existing Manim Python source file. Read the file first, then use the smallest replacement that fixes the render error; every oldText must match exactly once.",
  source: "custom:sandbox",
  configSchema: XYNE_LENS_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string" },
      path: { type: "string", description: "Relative Python source file, for example `gravity.py` or `scenes/gravity.py`." },
      replacements: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            oldText: { type: "string", description: "Exact existing text. It must occur exactly once." },
            newText: { type: "string", description: "Replacement text; may be empty to delete oldText." },
          },
          required: ["oldText", "newText"],
        },
      },
    },
    required: ["sessionId", "path", "replacements"],
  },
  async execute(params, context) {
    if (!context) return "Error: no execution context available.";
    const active = activeLensSession(params, context);
    if ("error" in active) return active.error;
    const path = safeSourcePath(params["path"]);
    if (!path) return "Error: path must be a safe relative .py source file name (for example `gravity.py` or `scenes/gravity.py`).";
    const replacements = params["replacements"];
    if (!Array.isArray(replacements) || replacements.length < 1 || replacements.length > 20) {
      return "Error: replacements must contain 1–20 exact replacements.";
    }
    try {
      const original = (await active.session.files.read(path)).toString("utf8");
      let updated = original;
      for (let index = 0; index < replacements.length; index += 1) {
        const replacement = replacements[index];
        if (typeof replacement !== "object" || replacement === null) {
          return `Error: replacements[${index}] must be an object.`;
        }
        const { oldText, newText } = replacement as Record<string, unknown>;
        if (typeof oldText !== "string" || oldText.length === 0 || typeof newText !== "string") {
          return `Error: replacements[${index}] requires a non-empty oldText and a string newText.`;
        }
        const first = updated.indexOf(oldText);
        if (first === -1) return `Error: replacements[${index}].oldText was not found. Read the current file and retry with an exact snippet.`;
        if (updated.indexOf(oldText, first + oldText.length) !== -1) {
          return `Error: replacements[${index}].oldText matched more than once. Include more surrounding context so the edit is unambiguous.`;
        }
        updated = `${updated.slice(0, first)}${newText}${updated.slice(first + oldText.length)}`;
      }
      await active.session.files.write(path, updated);
      return JSON.stringify({ path, edited: true, replacements: replacements.length, bytes: Buffer.byteLength(updated, "utf8") });
    } catch (error) {
      return `Error: failed to edit Xyne Lens file: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const xyneLensReadFile: ToolDefinition = {
  slug: "xyne-lens-read-file",
  name: "Xyne Lens Read File",
  description: "Read a Xyne Lens source or result file. Use relative names such as `gravity.py` or `preview.png`. To inspect the rendered video at any timestamp, call with `path: xyne-lens.mp4` and `atSeconds` (for example 4.5); Lens extracts that frame inside the isolated workspace.",
  source: "custom:sandbox",
  configSchema: XYNE_LENS_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string" },
      path: { type: "string" },
      atSeconds: { type: "number", minimum: 0, description: "Required only for `xyne-lens.mp4`; extracts an inspectable PNG at this timestamp." },
    },
    required: ["sessionId", "path"],
  },
  async execute(params, context) {
    if (!context) return "Error: no execution context available.";
    const active = activeLensSession(params, context);
    if ("error" in active) return active.error;
    const path = readableLensPath(params["path"]);
    if (!path) return "Error: path must be a safe relative Lens file name.";
    try {
      const requestedTimestamp = params["atSeconds"];
      if (path === OUTPUT_PATH) {
        const atSeconds = frameTimestampSeconds(requestedTimestamp);
        if (atSeconds === null) return "Error: reading `xyne-lens.mp4` requires a non-negative numeric atSeconds timestamp, for example 4.5.";
        const media = await probeMedia(active.session);
        if ("error" in media) return JSON.stringify({ error: media.error });
        if (atSeconds >= media.durationSeconds) {
          return `Error: atSeconds must be before the video end (${media.durationSeconds}s).`;
        }
        const framePath = framePathForTimestamp(atSeconds);
        const extract = await active.session.commands.run(
          `ffmpeg -y -v error -i ${OUTPUT_PATH} -ss ${atSeconds.toFixed(3)} -frames:v 1 ${framePath}`,
          60_000,
        );
        if (extract.exitCode !== 0) return `Error: failed to extract video frame: ${extract.stderr || extract.stdout}`;
        const frame = await active.session.files.read(framePath);
        return `[INSPECT:${framePath.split("/").pop()}:image/png]\n${frame.toString("base64")}`;
      }
      if (requestedTimestamp !== undefined) return "Error: atSeconds can only be used with `path: xyne-lens.mp4`.";
      const content = await active.session.files.read(path);
      if (!content.slice(0, 512).some((byte) => byte === 0)) return JSON.stringify({ path, content: content.toString("utf8"), encoding: "utf8" });
      const name = path.split("/").pop() ?? "file";
      const mime = name.endsWith(".png") ? "image/png" : "application/octet-stream";
      return `[INSPECT:${name}:${mime}]\n${content.toString("base64")}`;
    } catch (error) {
      return `Error: failed to read Xyne Lens file: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const xyneLensRender: ToolDefinition = {
  slug: "xyne-lens-render",
  name: "Xyne Lens Render",
  description: "Render a Manim scene in the active Xyne Lens session. Output is forced to H.264 MP4, 854×480, 30 fps and a PNG preview is produced.",
  source: "custom:sandbox",
  configSchema: XYNE_LENS_CONFIG_SCHEMA,
  inputSchema: { type: "object", properties: { sessionId: { type: "string" }, scriptPath: { type: "string", description: "Relative Manim Python path, for example `gravity.py` or `src/gravity.py`." }, scene: { type: "string" } }, required: ["sessionId", "scriptPath", "scene"] },
  async execute(params, context) {
    if (!context) return "Error: no execution context available.";
    const active = activeLensSession(params, context);
    if ("error" in active) return active.error;
    const scriptPath = safeSourcePath(params["scriptPath"]);
    const scene = safeSceneName(params["scene"]);
    if (!scriptPath || !scene) return "Error: scriptPath must be a safe relative .py file name (for example `gravity.py` or `src/gravity.py`) and scene must be a Python class name.";
    try {
      const render = await active.session.commands.run(
        `mkdir -p ${RESULTS_ROOT} ${ROOT}/build && rm -f ${OUTPUT_PATH} ${PREVIEW_PATH} && ` +
        `manim --renderer=cairo --format=mp4 --fps=${FPS} -r ${WIDTH},${HEIGHT} --media_dir ${ROOT}/build --output_file xyne-lens ${scriptPath} ${scene} && ` +
        `video=$(find ${ROOT}/build -type f -name 'xyne-lens.mp4' -print -quit) && test -n "$video" && ` +
        `ffmpeg -y -i "$video" -map 0:v:0 -an -c:v libx264 -pix_fmt yuv420p -r ${FPS} -s ${WIDTH}x${HEIGHT} -movflags +faststart ${OUTPUT_PATH} && ` +
        `ffmpeg -y -ss 0 -i ${OUTPUT_PATH} -frames:v 1 ${PREVIEW_PATH}`,
        6 * 60_000,
      );
      if (render.exitCode !== 0) return JSON.stringify({ error: "Manim render failed", stderr: render.stderr.slice(-6000), stdout: render.stdout.slice(-2000) });
      const media = await probeMedia(active.session);
      if ("error" in media) return JSON.stringify({ error: media.error });
      return JSON.stringify({ outputPath: OUTPUT_PATH, previewPath: PREVIEW_PATH, width: WIDTH, height: HEIGHT, fps: FPS, bytes: media.bytes, durationSeconds: media.durationSeconds, next: "Inspect preview.png or a chosen timestamp with xyne-lens-read-file (`path: xyne-lens.mp4`, `atSeconds: 4.5`), then call xyne-lens-deliver." });
    } catch (error) {
      return `Error: Xyne Lens render failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const xyneLensDeliver: ToolDefinition = {
  slug: "xyne-lens-deliver",
  name: "Xyne Lens Deliver",
  description: "Validate and attach the final Xyne Lens MP4, then clean the Lens workspace. Only a compliant 854×480/30fps H.264 MP4 up to 100 MiB can be delivered.",
  source: "custom:sandbox",
  configSchema: XYNE_LENS_CONFIG_SCHEMA,
  inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
  async execute(params, context) {
    if (!context) return "Error: no execution context available.";
    const active = activeLensSession(params, context);
    if ("error" in active) return active.error;
    try {
      const media = await probeMedia(active.session);
      if ("error" in media) return JSON.stringify({ error: media.error });
      const output = await active.session.files.read(OUTPUT_PATH);
      if (output.length !== media.bytes || output.length > MAX_DELIVERY_BYTES) return "Error: rendered file size changed before delivery.";
      return `[ATTACHMENT:xyne-lens.mp4:video/mp4]\n${output.toString("base64")}\n\nRendered Xyne Lens animation (${WIDTH}×${HEIGHT}, ${FPS} fps, ${media.durationSeconds}s).`;
    } catch (error) {
      return `Error: Xyne Lens delivery failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (active.local) {
        try { await active.session.destroy(); } catch { /* local cleanup is best effort */ }
        LOCAL_SESSIONS.delete(active.storeKey);
      } else {
        try { await (active.session as Session).destroy(); } catch { /* Kata expiry is the fallback */ }
        forgetSandboxSession(active.session as Session, active.storeKey);
      }
    }
  },
};
