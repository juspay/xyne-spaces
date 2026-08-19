/**
 * /record-skill recording analyzer.
 *
 * The raw upload is held in the run's ephemeral workspace, then copied by this
 * server-owned tool into the conversation's existing writable Kata sandbox.
 * The model never chooses a host path or an ffmpeg command. It receives only a
 * chronological contact sheet and non-sensitive media metadata, after which
 * the ordinary approval-gated create-skill tool owns persistence.
 */
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import type { ToolDefinition, ToolExecutionContext } from "../types.js";
import {
  SANDBOX_CONFIG_SCHEMA,
  buildSandboxStoreKey,
  getSandboxSession,
  probeSession,
} from "../sandbox/index.js";

const MAX_RECORDING_BYTES = 1024 * 1024 * 1024;
const CONTACT_SHEET_FRAMES = 12;
const RENDER_TIMEOUT_MS = 30 * 60 * 1000;
const AUTH_URL_DEFAULT = "http://xyne-claw-auth.xyne-apps.svc.cluster.local:3003";
const SANDBOX_WORK_ROOT = "/home/nixuser/workspace/.record-skill";

interface RecordingFile {
  fileName: string;
  mimeType: string;
  fileSize?: number;
  relPath?: string;
  attachmentId?: string;
}

function recordingFiles(context: ToolExecutionContext): RecordingFile[] {
  const encoded = context.meta?.["recordingFiles"];
  if (!encoded) return [];
  try {
    const parsed = JSON.parse(encoded) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RecordingFile => {
      if (!item || typeof item !== "object") return false;
      const value = item as Record<string, unknown>;
      return typeof value["fileName"] === "string" &&
        typeof value["mimeType"] === "string" &&
        (typeof value["relPath"] === "string" || typeof value["attachmentId"] === "string");
    });
  } catch {
    return [];
  }
}

function selectRecording(files: RecordingFile[], requested: string): RecordingFile | string {
  if (files.length === 0) return "No screen recording was attached to this /record-skill request.";
  if (!requested.trim()) {
    return files.length === 1
      ? files[0]!
      : `More than one recording is attached. Pass fileName as one of: ${files.map((f) => f.fileName).join(", ")}`;
  }
  const match = files.find((f) => f.fileName === requested);
  return match ?? `Recording ${JSON.stringify(requested)} was not attached. Available: ${files.map((f) => f.fileName).join(", ")}`;
}

function finiteDuration(raw: string): number {
  try {
    const parsed = JSON.parse(raw) as { format?: { duration?: string | number } };
    const duration = Number(parsed.format?.duration ?? 0);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

async function runLongSandboxCommand(
  session: NonNullable<ReturnType<typeof getSandboxSession>>,
  command: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const jobId = await session.commands.runDetached(command);
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await session.commands.pollJob(jobId);
    if (status.done) {
      return {
        stdout: status.stdout,
        stderr: status.stderr,
        exitCode: status.exitCode ?? 1,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("ffmpeg recording analysis timed out after 30 minutes");
}

export const analyzeSkillRecording: ToolDefinition = {
  slug: "analyze-skill-recording",
  name: "Analyze Skill Recording",
  description:
    "Analyze a screen recording attached to the current /record-skill request inside the SAME writable coding sandbox used by the conversation. " +
    "Call sandbox-create first. This tool securely copies only the server-staged recording, samples it with fixed ffprobe/ffmpeg commands, deletes the sandbox copy, and returns a 12-frame contact sheet visible only to the agent. " +
    "The frames are chronological in row-major order (left-to-right, then top-to-bottom). Call once per attached recording before drafting the skill.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      fileName: {
        type: "string",
        description: "Exact attached recording filename. Optional when exactly one recording was attached.",
      },
    },
    required: [],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    if (context.meta?.["taskCommand"] !== "/record-skill") {
      return "Error: analyze-skill-recording is available only during a /record-skill run.";
    }

    const selected = selectRecording(recordingFiles(context), String(params["fileName"] ?? ""));
    if (typeof selected === "string") return `Error: ${selected}`;

    let hostPath: string | undefined;
    if (!selected.attachmentId) {
      const workspaceDir = context.meta?.["recordingWorkspaceDir"];
      if (!workspaceDir || !selected.relPath) return "Error: Recording workspace metadata is unavailable.";
      const workspaceRoot = resolve(workspaceDir);
      hostPath = resolve(workspaceRoot, selected.relPath);
      if (hostPath !== workspaceRoot && !hostPath.startsWith(`${workspaceRoot}${sep}`)) {
        return "Error: Refusing a recording path outside the run workspace.";
      }
    }

    const storeKey = buildSandboxStoreKey(
      context.meta?.["userId"],
      context.meta?.["conversationId"],
      context.meta?.["agentSlug"],
    );
    if (!storeKey) return "Error: No conversation context is available for the sandbox.";
    const session = getSandboxSession(storeKey);
    if (!session || !(await probeSession(session, storeKey))) {
      return "Error: No live sandbox exists for this conversation. Call sandbox-create first, then retry.";
    }

    let expectedBytes = selected.fileSize;
    if (hostPath) {
      let info;
      try {
        info = await stat(hostPath);
      } catch {
        return `Error: The staged recording ${JSON.stringify(selected.fileName)} is no longer available.`;
      }
      if (!info.isFile()) return "Error: The staged recording is not a file.";
      expectedBytes = info.size;
    }
    if (!expectedBytes || expectedBytes > MAX_RECORDING_BYTES) {
      return `Error: Recording is too large or has no valid size (maximum is ${MAX_RECORDING_BYTES / 1024 / 1024 / 1024}GB).`;
    }

    const jobId = randomUUID().replace(/-/g, "");
    const workDir = `${SANDBOX_WORK_ROOT}/${jobId}`;
    const rawExt = extname(selected.fileName).toLowerCase();
    const safeExt = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : ".mp4";
    const inputPath = `${workDir}/input${safeExt}`;
    const outputPath = `${workDir}/contact-sheet.png`;
    let abortDownload: AbortController | undefined;
    let downloadTimeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const prepared = await session.commands.run(
        `mkdir -p ${workDir} && command -v ffmpeg && command -v ffprobe`,
        15_000,
      );
      if (prepared.exitCode !== 0) {
        return "Error: The coding sandbox image does not contain ffmpeg and ffprobe.";
      }
      let source: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;
      if (selected.attachmentId) {
        if (!context.sessionId || !context.sessionToken || !context.s2sKey) {
          return "Error: Per-run credentials are unavailable for the recording stream.";
        }
        abortDownload = new AbortController();
        downloadTimeout = setTimeout(() => abortDownload?.abort(), 30 * 60 * 1000);
        downloadTimeout.unref();
        const authBase = (process.env["XYNE_CLAW_AUTH_URL"] ?? AUTH_URL_DEFAULT).replace(/\/+$/, "");
        const response = await fetch(
          `${authBase}/claw/api/v1/internal/run/${encodeURIComponent(context.sessionId)}/recordings/${encodeURIComponent(selected.attachmentId)}`,
          {
            headers: {
              "x-s2s-key": context.s2sKey,
              "x-session-token": context.sessionToken,
            },
            signal: abortDownload.signal,
          },
        );
        if (!response.ok || !response.body) {
          const detail = await response.text().catch(() => "");
          return `Error: Could not stream recording from claw-auth (HTTP ${response.status}): ${detail.slice(0, 240)}`;
        }
        source = response.body;
      } else {
        source = createReadStream(hostPath!);
      }

      const streamed = await session.files.writeStream(inputPath, source, {
        maxBytes: MAX_RECORDING_BYTES,
        chunkBytes: 4 * 1024 * 1024,
      });
      if (downloadTimeout) clearTimeout(downloadTimeout);
      abortDownload?.abort();
      // expectedBytes is webhook-carried metadata, which for Spaces attachments
      // is CLIENT-reported at draft time (before the upload even finishes) —
      // it can legitimately differ from the bytes GCS actually serves. A size
      // mismatch alone must therefore not brick the recording forever: let
      // ffprobe decide whether the transferred file is readable, and only fail
      // when it isn't. Zero bytes is still fatal (nothing arrived).
      if (streamed.bytesWritten === 0) {
        return `Error: Recording transfer was incomplete (0 of ${expectedBytes} bytes).`;
      }
      const sizeMismatch = streamed.bytesWritten !== expectedBytes
        ? ` (transferred ${streamed.bytesWritten} bytes vs ${expectedBytes} reported at upload)`
        : "";

      const probe = await session.commands.run(
        `ffprobe -v error -show_entries format=duration -of json ${inputPath}`,
        15_000,
      );
      if (probe.exitCode !== 0) {
        return `Error: ffprobe could not read ${selected.fileName}${sizeMismatch} — the transfer may be truncated or the format unsupported.`;
      }
      const durationSec = finiteDuration(probe.stdout);
      // Exactly CONTACT_SHEET_FRAMES samples spanning the WHOLE clip. A lower
      // fps floor (previously 1/300) emitted extra frames on recordings longer
      // than an hour, and tile=4x3 + -frames:v 1 kept only the first 12 — the
      // sheet silently covered just the first hour of a 90-minute demo.
      const fps = durationSec > 0 ? CONTACT_SHEET_FRAMES / durationSec : 1 / 3;

      // A single ~1960×842 contact sheet is much cheaper for the model than 12
      // image result blocks while preserving enough resolution to read UI text.
      // tile order is chronological: left→right, then top→bottom.
      const filter =
        `fps=${fps.toFixed(6)},` +
        "scale=480:270:force_original_aspect_ratio=decrease," +
        "pad=480:270:(ow-iw)/2:(oh-ih)/2:color=0x101418," +
        "tile=4x3:padding=8:margin=8:color=0x05070a";
      const rendered = await runLongSandboxCommand(
        session,
        `timeout 29m ffmpeg -hide_banner -loglevel error -i ${inputPath} -vf "${filter}" -frames:v 1 ${outputPath}`,
      );
      if (rendered.exitCode !== 0) {
        return `Error: ffmpeg could not sample ${selected.fileName}: ${rendered.stderr.slice(0, 300)}`;
      }

      const contactSheet = await session.files.read(outputPath);
      const durationLabel = durationSec > 0 ? `${durationSec.toFixed(1)}s` : "unknown duration";
      return (
        `[INSPECT:recording-contact-sheet.png:image/png]\n${contactSheet.toString("base64")}\n` +
        `Recording analysis for ${selected.fileName}: ${durationLabel}${sizeMismatch}, up to ${CONTACT_SHEET_FRAMES} frames sampled across the full clip. ` +
        "Read the contact sheet chronologically from left to right, then top to bottom. Infer only actions visibly supported by the frames."
      );
    } catch (err) {
      return `Error: Recording analysis failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      if (downloadTimeout) clearTimeout(downloadTimeout);
      abortDownload?.abort();
      // Cleanup is deliberately fixed to a UUID-owned subdirectory. Never put
      // a model/user value into this destructive command.
      await session.commands.run(`rm -rf ${workDir}`, 15_000).catch(() => {});
    }
  },
};
