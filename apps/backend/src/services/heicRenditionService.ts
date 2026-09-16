import { createHash } from "crypto"
import decode from "heic-decode"
import pLimit from "p-limit"
import sharp from "sharp"
import { isPreconditionFailed } from "@xyne/storage"
import { logger } from "@/utils/logger"
import { storageService } from "@/services/storage"

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
 * WebP lossless is bit-exact relative to the decoded HEIC pixels (verified:
 * roundtrip is pixel-identical), so no fidelity is lost beyond the HEIC's own
 * compression.
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

// Decode + encode are CPU- and memory-bound; an uncapped flood of first-time
// requests would run one full-image decode per request and risk OOM-ing the
// pod. Excess requests queue behind this limiter.
const HEIC_MAX_CONCURRENCY = Number(process.env.HEIC_MAX_CONCURRENCY) || 2
const conversionLimit = pLimit(HEIC_MAX_CONCURRENCY)

// Cached in GCS, keyed on the sha256 of the *original* bytes — attachments
// are immutable once uploaded, so entries are content-addressed and never
// need to expire. Renditions land in the same bucket as the original.
const GCS_CACHE_PREFIX = "heic-rendition-cache"

const HEIC_MIME_TYPES = new Set([
    "image/heic",
    "image/heif",
    "image/heic-sequence",
    "image/heif-sequence",
])

const HEIC_EXTENSIONS = [".heic", ".heif", ".hif"]

/**
 * HEIC detection for an attachment. The client-supplied MIME type is checked
 * first, but not every browser reports one for HEIC (Chrome on Linux reports
 * application/octet-stream), so the filename extension is accepted as a
 * fallback — the same dual check the client applies when deciding to request
 * a rendition, so the two stay in agreement.
 */
export function isHeicAttachment(mimetype: string, originalFilename: string): boolean {
    if (HEIC_MIME_TYPES.has((mimetype || "").split(";")[0].trim().toLowerCase())) return true
    const lower = (originalFilename || "").toLowerCase()
    return HEIC_EXTENSIONS.some(ext => lower.endsWith(ext))
}

/** 'IMG_4032.heic' → 'IMG_4032.webp' (used for the rendition's download name). */
export function toWebpFilename(originalFilename: string): string {
    const stem = (originalFilename || "").replace(/\.[^./\\]+$/, "")
    return `${stem || "image"}.webp`
}

export class HeicRenditionError extends Error {
    constructor(
        message: string,
        public readonly code: "NOT_HEIC" | "TOO_LARGE" | "CONVERSION_FAILED",
    ) {
        super(message)
        this.name = "HeicRenditionError"
    }
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

async function writeGcsCache(
    storage: typeof storageService,
    gcsPath: string,
    buffer: Buffer,
    contentHash: string,
): Promise<void> {
    try {
        // Content-addressed, so a collision means another replica already
        // cached the identical bytes concurrently — not an error.
        await storage.uploadFileV2(buffer, {
            path: gcsPath,
            contentType: "image/webp",
            ifNotExists: true,
        })
    } catch (err) {
        if (isPreconditionFailed(err)) return
        logger.warn("[HeicRendition] Failed to write GCS cache entry", {
            contentHash,
            error: err instanceof Error ? err.message : String(err),
        })
    }
}

async function convertBufferToWebp(buffer: Buffer, kind: HeicRenditionKind, contentHash: string): Promise<Buffer> {
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
            contentHash,
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
 * renditions are cached alongside it, content-addressed by the original's
 * sha256.
 */
export async function getHeicRendition(
    storage: typeof storageService,
    storagePath: string,
    kind: HeicRenditionKind,
): Promise<Buffer> {
    const buffer = await storage.getFileBuffer(storagePath)
    const contentHash = createHash("sha256").update(buffer).digest("hex")
    const cachePath = `${GCS_CACHE_PREFIX}/${contentHash}/${kind}.webp`

    const gcsHit = await readGcsCache(storage, cachePath)
    if (gcsHit) {
        logger.info("[HeicRendition] GCS cache hit", { contentHash, kind })
        return gcsHit
    }

    const webp = await conversionLimit(() => convertBufferToWebp(buffer, kind, contentHash))

    await writeGcsCache(storage, cachePath, webp, contentHash)

    return webp
}
