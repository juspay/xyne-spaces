import { createHash } from "crypto"
import decode from "heic-decode"
import pLimit from "p-limit"
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
 * WebP rendition is produced lazily on first request — the same model Slack
 * uses for image derivatives.
 *
 * Decoding goes through heic-decode (libheif compiled to WASM with the HEVC
 * decoder included), not sharp: sharp's prebuilt libheif is built without
 * libde265, so it cannot decode the HEVC-compressed HEICs iPhones produce.
 * sharp handles the resize + WebP-lossless encode once pixels are in memory.
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

// Decode + encode are CPU- and memory-bound; an uncapped flood of first-time
// requests would run one full-image decode per request and risk OOM-ing the
// pod. Excess requests queue behind this limiter.
const HEIC_MAX_CONCURRENCY = Number(process.env.HEIC_MAX_CONCURRENCY) || 2
const conversionLimit = pLimit(HEIC_MAX_CONCURRENCY)

// Concurrent first views of the same attachment share one conversion instead
// of queueing one full decode per viewer behind the limiter.
const inFlightConversions = new Map<string, Promise<Buffer>>()

const TRANSIENT_FAILURE_TTL_MS = 60_000

const GCS_CACHE_PREFIX = "heic-rendition-cache/v1"

export class HeicRenditionError extends Error {
    constructor(
        message: string,
        public readonly code: "NOT_HEIC" | "TOO_LARGE" | "CONVERSION_FAILED",
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

async function convertBufferToWebp(
    buffer: Buffer,
    kind: HeicRenditionKind,
    cacheKey: string,
): Promise<Buffer> {
    // decode.all parses item handles first, so dimensions are known (and
    // checkable) before the decoder allocates width*height*4 bytes of WASM
    // memory for the actual pixel decode.
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

        // libheif applies irot/imir (HEIC's native rotation/mirror
        // properties) during decode, so the RGBA output is already upright —
        // no EXIF-orientation handling is needed here.
        const { data, width, height } = await image.decode()

        let pipeline = sharp(Buffer.from(data), {
            raw: { width, height, channels: 4 },
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

        const webp = await pipeline
            .webp({ lossless: true, quality: 100, effort: 5 })
            .toBuffer()

        logger.info("[HeicRendition] Converted HEIC to WebP", {
            cacheKey,
            kind,
            width,
            height,
            inputBytes: buffer.length,
            outputBytes: webp.length,
        })

        return webp
    } catch (err) {
        if (err instanceof HeicRenditionError) throw err
        throw new HeicRenditionError(
            `HEIC conversion failed: ${err instanceof Error ? err.message : String(err)}`,
            "CONVERSION_FAILED",
        )
    } finally {
        images.dispose()
    }
}

/**
 * Returns a WebP-lossless rendition of the HEIC file at `storagePath`,
 * generating and caching it on first request. `full` re-encodes the decoded
 * pixels without resizing; `thumb` fits within 1024px on the long edge.
 * `storage` is the bucket the original lives in (see getAttachmentStorage) —
 * renditions are cached alongside it, keyed by the original's storage path.
 */
export async function getHeicRendition(
    storage: typeof storageService,
    storagePath: string,
    kind: HeicRenditionKind,
): Promise<Buffer> {
    const base = cacheBasePath(storagePath)
    const cachePath = `${base}/${kind}.webp`
    const markerPath = `${base}/${kind}.failed`
    const flightKey = `${base}/${kind}`

    const gcsHit = await readGcsCache(storage, cachePath)
    if (gcsHit) {
        logger.info("[HeicRendition] GCS cache hit", { cacheKey: flightKey })
        return gcsHit
    }

    const marker = await readFailureMarker(storage, markerPath)
    if (isFailureMarkerActive(marker)) {
        throw new HeicRenditionError(
            `HEIC previously failed conversion (${marker.code}); see failure marker`,
            marker.code,
        )
    }

    const existingFlight = inFlightConversions.get(flightKey)
    if (existingFlight) return existingFlight

    const flight = (async (): Promise<Buffer> => {
        try {
            // Only a genuine cache miss pays for the full-resolution download.
            const buffer = await storage.getFileBuffer(storagePath)
            const webp = await conversionLimit(() => convertBufferToWebp(buffer, kind, flightKey))
            await writeGcsCache(storage, cachePath, webp, flightKey)
            return webp
        } catch (err) {
            if (err instanceof HeicRenditionError) {
                await writeFailureMarker(storage, markerPath, err.code)
            }
            throw err
        } finally {
            inFlightConversions.delete(flightKey)
        }
    })()
    inFlightConversions.set(flightKey, flight)
    return flight
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
