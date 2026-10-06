import { createHash } from "crypto"
import { isPreconditionFailed, normalizeStoragePath } from "@xyne/storage"
import { isHeicAttachment, toWebpFilename } from "@xyne/shared"
import { logger } from "@/utils/logger"
import { storageService } from "@/services/storage"
import {
    HeicRenditionThreadError,
    renderHeicBytes,
} from "@/services/heicRenditionPool"

export { isHeicAttachment, toWebpFilename }

/**
 * Server-side HEIC → WebP renditions for chat attachments.
 *
 * HEIC/HEIF photos (the default iPhone camera format) render in Safari only;
 * everywhere else they are a broken tile plus an opaque download. Rather than
 * re-encoding at upload time (which either discards the original or doubles
 * storage), the original HEIC stays byte-exact in GCS and a browser-renderable
 * WebP rendition is derived from it — the same model Slack uses for image
 * derivatives.
 *
 * Decoding goes through heic-decode (libheif compiled to WASM with the HEVC
 * decoder included), not sharp: sharp's prebuilt libheif is built without
 * libde265, so it cannot decode the HEVC-compressed HEICs iPhones produce.
 * sharp handles the resize + WebP encode once pixels are in memory.
 *
 * The WASM decode is synchronous and takes seconds per photo, so it never runs
 * on the API's request path — it would stall the event loop for the whole
 * decode, freezing everything else the pod is doing. For the same reason it
 * doesn't run on the queue worker's event loop either: the API enqueues a job
 * (heicRenditionQueue) at upload time and again on read misses, and the
 * consuming worker hands the bytes to a worker_threads pool
 * (heicRenditionPool) that decodes + encodes on dedicated threads, keeping
 * the host process's loop responsive. Until the rendition exists, reads
 * report PENDING and clients retry briefly.
 *
 * Renditions are cached in GCS keyed on the sha256 of the storage *path*.
 * Attachment bytes are immutable once uploaded, so the path is a stable key —
 * and unlike a content hash it costs nothing to compute, which keeps cache
 * hits at one small WebP read instead of a full-resolution download of the
 * original. The v1 segment lets future conversion-parameter changes start a
 * fresh cache instead of serving stale renditions forever.
 */

export type HeicRenditionKind = "full" | "thumb"

const TRANSIENT_FAILURE_TTL_MS = 60_000

const GCS_CACHE_PREFIX = "heic-rendition-cache/v1"

export class HeicRenditionError extends Error {
    constructor(
        message: string,
        public readonly code: "NOT_HEIC" | "TOO_LARGE" | "CONVERSION_FAILED" | "PENDING",
    ) {
        super(message)
        this.name = "HeicRenditionError"
    }
}

interface FailureMarker {
    code: HeicRenditionError["code"]
    at: number
}

function cacheBasePath(storagePath: string): string {
    const normalized = normalizeStoragePath(storagePath)
    const pathHash = createHash("sha256").update(normalized).digest("hex")
    return `${GCS_CACHE_PREFIX}/${pathHash}`
}

function isPermanentFailure(code: HeicRenditionError["code"]): boolean {
    return code === "NOT_HEIC" || code === "TOO_LARGE"
}

function isFailureMarkerActive(marker: FailureMarker | null): marker is FailureMarker {
    if (!marker) return false
    if (isPermanentFailure(marker.code)) return true
    return Date.now() - marker.at < TRANSIENT_FAILURE_TTL_MS
}

async function readGcsCache(storage: typeof storageService, gcsPath: string): Promise<Buffer | null> {
    try {
        // getFileBuffer retries with backoff on a missing file (it's built
        // for "should exist, might not be finalized yet" reads) — pointless
        // delay on a genuine cache miss, so check existence first.
        const exists = await storage.fileExists(gcsPath)
        if (!exists) return null
        return await storage.getFileBuffer(gcsPath)
    } catch {
        return null
    }
}

async function readFailureMarker(
    storage: typeof storageService,
    markerPath: string,
): Promise<FailureMarker | null> {
    try {
        const exists = await storage.fileExists(markerPath)
        if (!exists) return null
        const raw = await storage.getFileBuffer(markerPath)
        return JSON.parse(raw.toString("utf8")) as FailureMarker
    } catch {
        return null
    }
}

async function writeGcsCache(
    storage: typeof storageService,
    gcsPath: string,
    buffer: Buffer,
    cacheKey: string,
): Promise<void> {
    try {
        // Path-keyed, so a collision means another replica already cached the
        // identical rendition concurrently — not an error.
        await storage.uploadFileV2(buffer, {
            path: gcsPath,
            contentType: "image/webp",
            ifNotExists: true,
        })
    } catch (err) {
        if (isPreconditionFailed(err)) return
        logger.warn("[HeicRendition] Failed to write GCS cache entry", {
            cacheKey,
            error: err instanceof Error ? err.message : String(err),
        })
    }
}

async function writeFailureMarker(
    storage: typeof storageService,
    markerPath: string,
    code: HeicRenditionError["code"],
): Promise<void> {
    try {
        const marker: FailureMarker = { code, at: Date.now() }
        await storage.uploadFileV2(Buffer.from(JSON.stringify(marker)), {
            path: markerPath,
            contentType: "application/json",
        })
    } catch (err) {
        logger.warn("[HeicRendition] Failed to write failure marker", {
            markerPath,
            error: err instanceof Error ? err.message : String(err),
        })
    }
}

/**
 * Generate and cache both renditions (`full` + `thumb`) of the HEIC original
 * at `storagePath`, decoding once. Runs in the queue worker; the CPU-bound
 * decode and encodes themselves run on heicRenditionPool's worker threads —
 * see that module for why this must never run on an event loop thread.
 *
 * Deterministic failures become failure markers instead of thrown errors, so
 * the job always completes and the read path falls back to its marker/PENDING
 * logic instead of erroring. A missing original (attachment deleted while the
 * job waited in the queue) is a no-op.
 */
export async function generateHeicRenditions(
    storage: typeof storageService,
    storagePath: string,
): Promise<void> {
    const base = cacheBasePath(storagePath)
    const kinds: HeicRenditionKind[] = ["full", "thumb"]

    // A re-enqueued job after a successful run: both renditions already cached.
    const cached = await Promise.all(
        kinds.map(kind => readGcsCache(storage, `${base}/${kind}.webp`)),
    )
    if (cached.every(entry => entry !== null)) return

    let buffer: Buffer
    try {
        buffer = await storage.getFileBuffer(storagePath)
    } catch {
        return
    }

    try {
        const { width, height, renditions } = await renderHeicBytes(buffer)
        for (const kind of kinds) {
            const webp = renditions[kind]
            logger.info("[HeicRendition] Converted HEIC to WebP", {
                cacheKey: `${base}/${kind}`,
                kind,
                width,
                height,
                outputBytes: webp.length,
            })
            await writeGcsCache(storage, `${base}/${kind}.webp`, webp, `${base}/${kind}`)
        }
    } catch (err) {
        const code = err instanceof HeicRenditionThreadError ? err.code : "CONVERSION_FAILED"
        logger.warn("[HeicRendition] Generation failed; writing failure markers", {
            storagePath,
            code,
            error: err instanceof Error ? err.message : String(err),
        })
        await Promise.all(
            kinds.map(kind => writeFailureMarker(storage, `${base}/${kind}.failed`, code)),
        )
    }
}

/**
 * Returns the cached WebP rendition of the HEIC file at `storagePath`.
 * `full` re-encodes the decoded pixels without resizing; `thumb` fits within
 * 1024px on the long edge. `storage` is the bucket the original lives in (see
 * getAttachmentStorage) — renditions are cached alongside it, keyed by the
 * original's storage path.
 */
export async function getHeicRendition(
    storage: typeof storageService,
    storagePath: string,
    kind: HeicRenditionKind,
): Promise<Buffer> {
    const base = cacheBasePath(storagePath)
    const cachePath = `${base}/${kind}.webp`
    const markerPath = `${base}/${kind}.failed`

    const gcsHit = await readGcsCache(storage, cachePath)
    if (gcsHit) {
        logger.info("[HeicRendition] GCS cache hit", { cacheKey: `${base}/${kind}` })
        return gcsHit
    }

    const marker = await readFailureMarker(storage, markerPath)
    if (isFailureMarkerActive(marker)) {
        throw new HeicRenditionError(
            `HEIC previously failed conversion (${marker.code}); see failure marker`,
            marker.code,
        )
    }

    throw new HeicRenditionError("HEIC rendition not yet generated", "PENDING")
}

/**
 * Best-effort deletion of every cached rendition and failure marker for the
 * attachment at `storagePath`. Called from attachment delete paths so a
 * deleted message does not leave derived copies of its file behind — the
 * originals are removed by the callers themselves.
 */
export async function deleteHeicRenditions(
    storagePath: string,
    storage: typeof storageService = storageService,
): Promise<void> {
    if (!storagePath) return
    const base = cacheBasePath(storagePath)
    const paths = (["full.webp", "thumb.webp", "full.failed", "thumb.failed"] as const).map(
        (name) => `${base}/${name}`,
    )
    await Promise.all(
        paths.map(async (path) => {
            try {
                await storage.deleteFile(path)
            } catch {
                // Missing entries are the common case; deletion is best-effort.
            }
        }),
    )
}
