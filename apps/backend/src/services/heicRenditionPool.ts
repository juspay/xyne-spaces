import { Worker } from "node:worker_threads"
import { logger } from "@/utils/logger"

/**
 * worker_threads pool that runs the HEIC decode + WebP encode OFF the hosting
 * process's event loop.
 *
 * The libheif WASM decode is synchronous and takes seconds per photo. Running
 * it on a Bull consumer thread would stall every other consumer sharing that
 * process (the shared worker.ts hosts the stitch worker, scheduled messages,
 * conversation ingestion, ...): concurrency guards in Bull only interleave
 * async work, they cannot interleave a synchronous WASM call on the one
 * thread. Each render therefore runs on a dedicated worker thread — that
 * thread's loop blocks for the decode, this process's loop does not — so the
 * rendition consumer is safe to co-host with every other worker.
 *
 * The thread does decode AND both encodes (full + thumb): the ~50MP RGBA
 * buffer (up to ~200MB transiently) then never crosses the thread boundary —
 * only the original HEIC bytes in and the two small WebP outputs back.
 *
 * The thread body is an eval-source string, not a co-located .ts entry file:
 * this package runs both as TypeScript (dev, tsx) and compiled JS (dist/),
 * plus jest compiles it to CJS (where `import.meta` is a syntax error) — an
 * inline CommonJS source needs no entry-file path resolution in any of them
 * and `require('heic-decode' | 'sharp')` resolves from the package the
 * process runs in, exactly like createRequire-based modulePath precedents
 * (xyne-claw's loop-watchdog). Its logic is kept a line-for-line match with
 * the pre-refactor heicRenditionService.ts pipeline.
 */

export type HeicRenditionFailureCode = "NOT_HEIC" | "TOO_LARGE" | "CONVERSION_FAILED"

export class HeicRenditionThreadError extends Error {
    constructor(
        message: string,
        public readonly code: HeicRenditionFailureCode,
    ) {
        super(message)
        this.name = "HeicRenditionThreadError"
    }
}

export interface HeicRenditionOutputs {
    width: number
    height: number
    renditions: Record<"full" | "thumb", Buffer>
}

// A 12MP iPhone photo decodes to ~48MB of RGBA in WASM memory before sharp
// re-encodes. 50MP (~200MB transient RGBA) is the same order as sharp's own
// default limitInputPixels and comfortably above any real phone camera output
// while keeping a maliciously large ispe header from OOM-ing the pod.
const MAX_PIXELS = 50_000_000
const WEBP_MAX_SIDE = 16383

// Thumb is only ever a chat-chip / gallery preview; 1024px on the long edge
// matches what the existing image thumbnail pipeline produces.
const THUMB_LONG_EDGE = 1024

const WEBP_QUALITY = 85
const WEBP_EFFORT = 4

/**
 * One render per thread at a time and THREAD_COUNT threads: libheif decodes
 * synchronously anyway, so more threads would hold the same total RGBA at a
 * lower utilization, and fewer would serialize decodes that Bull already
 * admitted. 2 in-flight renders bounds transient RGBA at ~2 photos (~400MB
 * worst case) on top of the pod's baseline — the same bound the pre-pool
 * queue worker had.
 */
export const HEIC_RENDITION_THREAD_COUNT = 2

const THREAD_SOURCE = String.raw`
const { parentPort } = require("node:worker_threads");
const decode = require("heic-decode");
const sharp = require("sharp");

const MAX_PIXELS = ${MAX_PIXELS};
const WEBP_MAX_SIDE = ${WEBP_MAX_SIDE};
const THUMB_LONG_EDGE = ${THUMB_LONG_EDGE};
const WEBP_QUALITY = ${WEBP_QUALITY};
const WEBP_EFFORT = ${WEBP_EFFORT};

class CodedError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function decodeHeicPixels(buffer) {
  let images;
  try {
    images = await decode.all({ buffer });
  } catch (err) {
    throw new CodedError("HEIC parse failed: " + (err && err.message || String(err)), "NOT_HEIC");
  }
  try {
    const image = images[0];
    if (!image) {
      throw new CodedError("No images found in HEIC container", "NOT_HEIC");
    }
    if (image.width * image.height > MAX_PIXELS) {
      throw new CodedError(
        "HEIC too large to convert: " + image.width + "x" + image.height,
        "TOO_LARGE",
      );
    }
    if (Math.max(image.width, image.height) > WEBP_MAX_SIDE) {
      throw new CodedError(
        "HEIC exceeds WebP's " + WEBP_MAX_SIDE + "px side limit: " + image.width + "x" + image.height,
        "TOO_LARGE",
      );
    }
    try {
      return await image.decode();
    } catch (err) {
      // Brand accepted but items undecodable — same fall-through as a
      // rejected brand, not a retryable conversion failure.
      throw new CodedError("HEIC pixel decode failed: " + (err && err.message || String(err)), "NOT_HEIC");
    }
  } finally {
    images.dispose();
  }
}

async function encodeWebpFromPixels(pixels, kind) {
  let pipeline = sharp(Buffer.from(pixels.data), {
    raw: { width: pixels.width, height: pixels.height, channels: 4 },
    limitInputPixels: MAX_PIXELS,
  });
  if (kind === "thumb") {
    pipeline = pipeline.resize({
      width: THUMB_LONG_EDGE,
      height: THUMB_LONG_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  // Lossy, not lossless: lossless WebP of already-lossy HEVC pixels inflates
  // ~10x for no visible gain, and the original HEIC remains the fidelity
  // source for downloads.
  return pipeline.webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT }).toBuffer();
}

parentPort.on("message", async (msg) => {
  const buffer = Buffer.from(msg.heic);
  try {
    const pixels = await decodeHeicPixels(buffer);
    // Sequential, not parallel: halves peak memory (one WebP output at a time
    // on top of the shared RGBA buffer).
    const full = await encodeWebpFromPixels(pixels, "full");
    const thumb = await encodeWebpFromPixels(pixels, "thumb");
    parentPort.postMessage({ ok: true, width: pixels.width, height: pixels.height, full, thumb });
  } catch (err) {
    const code = err && err.code === "NOT_HEIC" || err && err.code === "TOO_LARGE"
      ? err.code
      : "CONVERSION_FAILED";
    parentPort.postMessage({ ok: false, code, message: err && err.message || String(err) });
  }
});
`

type ThreadResponse =
    | { ok: true; width: number; height: number; full: Uint8Array; thumb: Uint8Array }
    | { ok: false; code: HeicRenditionFailureCode; message: string }

type PendingTask = {
    heic: Buffer
    resolve: (out: HeicRenditionOutputs) => void
    reject: (err: HeicRenditionThreadError) => void
}

type Slot = {
    thread: Worker
    current: PendingTask | null
}

let slots: Slot[] = []
let waiting: PendingTask[] = []

function spawnSlot(): Slot {
    const thread = new Worker(THREAD_SOURCE, { eval: true })
    const slot: Slot = { thread, current: null }

    thread.on("message", (msg: ThreadResponse) => {
        const task = slot.current
        slot.current = null
        if (task) {
            if (msg.ok) {
                task.resolve({
                    width: msg.width,
                    height: msg.height,
                    // postMessage clones can arrive as plain Uint8Array views;
                    // re-wrap so downstream consumers always get a Buffer.
                    renditions: { full: Buffer.from(msg.full), thumb: Buffer.from(msg.thumb) },
                })
            } else {
                task.reject(new HeicRenditionThreadError(msg.message, msg.code))
            }
        }
        dispatch()
    })

    const kill = (err: HeicRenditionThreadError) => {
        slots = slots.filter(s => s !== slot)
        void thread.terminate().catch(() => {})
        const task = slot.current
        slot.current = null
        if (task) task.reject(err)
        // Keep the pool at size so a restarted worker does not slowly drain
        // capacity with each poisoned photo.
        slots.push(spawnSlot())
        dispatch()
    }
    thread.on("error", err =>
        kill(new HeicRenditionThreadError(`HEIC rendition thread error: ${err.message}`, "CONVERSION_FAILED")),
    )
    thread.on("exit", code => {
        if (code !== 0 && slots.includes(slot)) {
            kill(new HeicRenditionThreadError(`HEIC rendition thread exited (code ${code})`, "CONVERSION_FAILED"))
        }
    })

    return slot
}

function dispatch(): void {
    for (const slot of slots) {
        if (slot.current) continue
        const task = waiting.shift()
        if (!task) return
        slot.current = task
        slot.thread.postMessage({ heic: task.heic })
    }
}

/**
 * Decode `heic` and encode both renditions on a worker thread. Rejects with
 * HeicRenditionThreadError carrying NOT_HEIC / TOO_LARGE / CONVERSION_FAILED;
 * the caller maps those to GCS failure markers as before.
 */
export function renderHeicBytes(heic: Buffer): Promise<HeicRenditionOutputs> {
    if (slots.length === 0) {
        for (let i = 0; i < HEIC_RENDITION_THREAD_COUNT; i++) slots.push(spawnSlot())
        logger.info("[HeicRendition] Spawned rendition thread pool", {
            threads: HEIC_RENDITION_THREAD_COUNT,
        })
    }
    return new Promise((resolve, reject) => {
        waiting.push({ heic, resolve, reject })
        dispatch()
    })
}

/** Terminate all rendition threads; pending and queued renders reject. */
export async function shutdownHeicRenditionPool(): Promise<void> {
    const gone = slots
    slots = []
    const queued = waiting
    waiting = []
    for (const task of queued) {
        task.reject(new HeicRenditionThreadError("HEIC rendition pool shut down", "CONVERSION_FAILED"))
    }
    await Promise.all(
        gone.map(async slot => {
            const task = slot.current
            slot.current = null
            if (task) {
                task.reject(new HeicRenditionThreadError("HEIC rendition pool shut down", "CONVERSION_FAILED"))
            }
            await slot.thread.terminate().catch(() => {})
        }),
    )
    logger.info("[HeicRendition] Rendition thread pool shut down")
}
