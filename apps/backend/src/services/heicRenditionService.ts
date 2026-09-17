import { createHash } from "crypto"
import decode from "heic-decode"
import sharp from "sharp"
import { isPreconditionFailed, normalizeStoragePath } from "@xyne/storage"
import { isHeicAttachment, toWebpFilename } from "@xyne/shared"
import { logger } from "@/utils/logger"
import { storageService } from "@/services/storage"

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
 * decode, freezing everything else the pod is doing. Instead the API enqueues
 * a job (heicRenditionQueue) at upload time, and again on read misses; the
 * dedicated queue worker decodes and caches. Until the rendition exists,
 * reads report PENDING and clients retry briefly.
 *
 * Renditions are cached in GCS keyed on the sha256 of the storage *path*.
 * Attachment bytes are immutable once uploaded, so the path is a stable key —
 * and unlike a content hash it costs nothing to compute, which keeps cache
 * hits at one small WebP read instead of a full-resolution download of the
 * original. The v1 segment lets future conversion-parameter changes start a
 * fresh cache instead of serving stale renditions forever.
 */

export type HeicRenditionKind = "full" | "thumb"

// Thumb is only ever a chat-chip / gallery preview; 1024px on the long edge
// matches what the existing image thumbnail pipeline produces.
const THUMB_LONG_EDGE = 1024

// A 12MP iPhone photo decodes to ~48MB of RGBA in WASM memory before sharp
// re-encodes. 50MP (~200MB transient RGBA) is the same order as sharp's own
// default limitInputPixels and comfortably above any real phone camera output
// while keeping a maliciously large ispe header from OOM-ing the pod.
const MAX_PIXELS = 50_000_000
const WEBP_MAX_SIDE = 16383

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

interface HeicPixels {
    width: number
    height: number
    /** RGBA pixel data, upright: libheif applies irot/imir during decode. */
    data: Uint8ClampedArray
}

/**
 * Decode HEIC bytes to RGBA pixels. Queue-worker only: libheif's WASM decode
 * is synchronous, so it stalls the calling thread for the full decode — on
 * the API's request path that would freeze the pod for seconds per photo.
 *
 * Both container-parse and pixel-decode failures map to NOT_HEIC: the bytes
 * are not something we can decode as HEIC (renamed file, an AVIF in an mif1
 * container whose AV1 track libheif cannot decode, corrupt stream). That is
 * a fall-through condition for callers — serve the original — not a
 * retryable error, because the bytes are immutable.
 */
async function decodeHeicPixels(buffer: Buffer): Promise<HeicPixels> {
    let images
    try {
        images = await decode.all({ buffer })
    } catch (err) {
        throw new HeicRenditionError(
            `HEIC parse failed: ${err instanceof Error ? err.message : String(err)}`,
            "NOT_HEIC",
        )
    }

    try {
        const image = images[0]
        if (!image) {
            throw new HeicRenditionError("No images found in HEIC container", "NOT_HEIC")
        }
        if (image.width * image.height > MAX_PIXELS) {
            throw new HeicRenditionError(
                `HEIC too large to convert: ${image.width}x${image.height}`,
                "TOO_LARGE",
            )
        }
        if (Math.max(image.width, image.height) > WEBP_MAX_SIDE) {
            throw new HeicRenditionError(
                `HEIC exceeds WebP's ${WEBP_MAX_SIDE}px side limit: ${image.width}x${image.height}`,
                "TOO_LARGE",
            )
        }

        try {
            const { data, width, height } = await image.decode()
            return { width, height, data }
        } catch (err) {
            // Brand accepted but items undecodable — same fall-through as a
            // rejected brand, not a retryable conversion failure.
            throw new HeicRenditionError(
                `HEIC pixel decode failed: ${err instanceof Error ? err.message : String(err)}`,
                "NOT_HEIC",
            )
        }
    } finally {
        images.dispose()
    }
}

async function encodeWebpFromPixels(
    pixels: HeicPixels,
    kind: HeicRenditionKind,
    cacheKey: string,
): Promise<Buffer> {
    try {
        let pipeline = sharp(Buffer.from(pixels.data), {
            raw: { width: pixels.width, height: pixels.height, channels: 4 },
            limitInputPixels: MAX_PIXELS,
        })
        if (kind === "thumb") {
            pipeline = pipeline.resize({
                width: THUMB_LONG_EDGE,
                height: THUMB_LONG_EDGE,
                fit: "inside",
                withoutEnlargement: true,
            })
        }

        // Lossy q85, not lossless: lossless WebP of already-lossy HEVC pixels
        // inflates ~10x for no visible gain, and the original HEIC remains the
        // fidelity source for downloads. (Parameter changes bump the cache
        // version segment so stale renditions are never served.)
        const webp = await pipeline.webp({ quality: 85, effort: 4 }).toBuffer()

        logger.info("[HeicRendition] Converted HEIC to WebP", {
            cacheKey,
            kind,
            width: pixels.width,
            height: pixels.height,
            outputBytes: webp.length,
        })

        return webp
    } catch (err) {
        if (err instanceof HeicRenditionError) throw err
        throw new HeicRenditionError(
            `HEIC conversion failed: ${err instanceof Error ? err.message : String(err)}`,
            "CONVERSION_FAILED",
        )
    }
}

/**
 * Generate and cache both renditions (`full` + `thumb`) of the HEIC original
 * at `storagePath`, decoding once. Runs in the queue worker — see
 * decodeHeicPixels for why this must never run on the request path.
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
        const pixels = await decodeHeicPixels(buffer)
        // Sequential, not Promise.all: halves peak memory (one WebP output at
        // a time on top of the shared RGBA buffer).
        for (const kind of kinds) {
            const webp = await encodeWebpFromPixels(pixels, kind, `${base}/${kind}`)
            await writeGcsCache(storage, `${base}/${kind}.webp`, webp, `${base}/${kind}`)
        }
    } catch (err) {
        const code = err instanceof HeicRenditionError ? err.code : "CONVERSION_FAILED"
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
