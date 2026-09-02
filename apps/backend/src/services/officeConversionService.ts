import { spawn } from "child_process"
import { createHash, randomBytes } from "crypto"
import { mkdtemp, readFile, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import pLimit from "p-limit"
import { logger } from "@/utils/logger"
import { storageService } from "@/services/storage"
import { isPreconditionFailed } from "@xyne/storage"

/**
 * Converts an office document (pptx, docx, xlsx, ...) to PDF via LibreOffice's
 * headless CLI — the same approach Google Drive/Slack/Notion previews use.
 * Reimplementing OOXML rendering in the browser (the prior approach for the
 * PPTX viewer) can never be "exact": OOXML is too large a spec, and every
 * fixed gap (theme colors, placeholder inheritance, custom geometry, picture
 * effects) just reveals the next one. Shelling out to a real office engine
 * sidesteps that entirely by letting it do the rendering.
 *
 * `-env:UserInstallation` gives each conversion its own LibreOffice profile
 * directory — soffice locks its profile against concurrent use, so sharing
 * the default profile across concurrent requests causes conversions to hang
 * or fail outright.
 */

const SOFFICE_BINARY = process.env.SOFFICE_PATH || "soffice"
const CONVERSION_TIMEOUT_MS = 60_000

// Each soffice invocation is a real process with a non-trivial memory
// footprint; an uncapped flood of requests for files the cache hasn't seen
// yet (e.g. many first-time opens at once) would spawn one soffice per
// request and risk OOM-ing the pod. Bounds how many run at once per pod —
// excess requests queue behind this limiter rather than all spawning
// immediately.
const SOFFICE_MAX_CONCURRENCY = Number(process.env.SOFFICE_MAX_CONCURRENCY) || 3
const conversionLimit = pLimit(SOFFICE_MAX_CONCURRENCY)

// Cached in GCS (the same bucket every other upload in this app already
// uses), keyed on the content hash — this endpoint is stateless (no
// file/collection id, just bytes), so content is the only key available.
// Content-addressed and immutable, so entries never need to expire.
const GCS_CACHE_PREFIX = "office-conversion-cache"

// Uploaded bytes are staged here (randomly-keyed, short-lived) so soffice
// can fetch them via a signed URL instead of us writing them to local disk
// ourselves. Deleted right after each conversion in the finally block below.
const INPUT_GCS_PREFIX = "office-conversion-tmp-input"
const SIGNED_URL_EXPIRY_HOURS = 10 / 60 // 10 min — comfortably longer than CONVERSION_TIMEOUT_MS below

export class OfficeConversionError extends Error {
    constructor(
        message: string,
        public readonly code: "SOFFICE_NOT_FOUND" | "TIMEOUT" | "CONVERSION_FAILED",
    ) {
        super(message)
        this.name = "OfficeConversionError"
    }
}

async function readGcsCache(gcsPath: string): Promise<Buffer | null> {
    try {
        // getFileBuffer retries with backoff on a missing file (it's built
        // for "should exist, might not be finalized yet" reads) — pointless
        // delay on a genuine cache miss, so check existence first.
        const exists = await storageService.fileExists(gcsPath)
        if (!exists) return null
        return await storageService.getFileBuffer(gcsPath)
    } catch {
        return null
    }
}

async function writeGcsCache(gcsPath: string, buffer: Buffer, contentHash: string): Promise<void> {
    try {
        // Content-addressed, so a collision means another replica already
        // cached the identical bytes concurrently — not an error.
        await storageService.uploadFileV2(buffer, {
            path: gcsPath,
            contentType: "application/pdf",
            ifNotExists: true,
        })
    } catch (err) {
        if (isPreconditionFailed(err)) return
        logger.warn("[OfficeConversion] Failed to write GCS cache entry", {
            contentHash,
            error: err instanceof Error ? err.message : String(err),
        })
    }
}

// Pure function of the content — callers that need to know where a
// buffer's converted PDF lives in GCS (e.g. to point the async OCR
// scheduler's page-splitter at it directly) can compute this without
// re-running the conversion, since it's the exact path convertToPdf
// itself reads from/writes to below.
export function getConvertedPdfGcsPath(buffer: Buffer): string {
    const contentHash = createHash("sha256").update(buffer).digest("hex")
    return `${GCS_CACHE_PREFIX}/${contentHash}.pdf`
}

export async function convertToPdf(buffer: Buffer, originalFilename: string): Promise<Buffer> {
    const contentHash = createHash("sha256").update(buffer).digest("hex")
    const gcsPath = getConvertedPdfGcsPath(buffer)

    const gcsHit = await readGcsCache(gcsPath)
    if (gcsHit) {
        logger.info("[OfficeConversion] GCS cache hit", { contentHash })
        return gcsHit
    }

    const workDir = await mkdtemp(path.join(tmpdir(), "office-convert-"))
    const profileDir = path.join(workDir, "profile")
    // originalFilename is attacker-controlled (the client-supplied upload
    // name); only accept a plain alphanumeric extension so nothing in it
    // (path separators, "..", null bytes, ...) can influence the temp GCS
    // key or the local output path.
    const rawExt = path.extname(originalFilename)
    const ext = /^\.[a-zA-Z0-9]{1,10}$/.test(rawExt) ? rawExt : ".bin"
    const outputPath = path.join(workDir, "input.pdf")

    // Random subdirectory (not just filename) so the object's full key is
    // unguessable; the basename stays fixed as "input<ext>" so soffice's
    // derived output filename stays predictable ("input.pdf") regardless of
    // the signed URL's query-string suffix.
    const inputGcsKey = `${INPUT_GCS_PREFIX}/${contentHash}-${randomBytes(8).toString("hex")}/input${ext}`

    try {
        await storageService.uploadFileV2(buffer, {
            path: inputGcsKey,
            contentType: "application/octet-stream",
        })
        const inputUrl = await storageService.generateSignedUrl(inputGcsKey, SIGNED_URL_EXPIRY_HOURS)

        await conversionLimit(() => new Promise<void>((resolve, reject) => {
            const args = [
                "--headless",
                "--norestore",
                `-env:UserInstallation=file://${profileDir}`,
                "--convert-to",
                "pdf",
                "--outdir",
                workDir,
                inputUrl,
            ]
            const proc = spawn(SOFFICE_BINARY, args)

            let stderr = ""
            let stdout = ""
            const timer = setTimeout(() => {
                proc.kill("SIGKILL")
                reject(new OfficeConversionError("LibreOffice conversion timed out", "TIMEOUT"))
            }, CONVERSION_TIMEOUT_MS)

            proc.stderr.on("data", chunk => {
                stderr += chunk.toString()
            })
            proc.stdout.on("data", chunk => {
                stdout += chunk.toString()
            })
            proc.on("error", err => {
                clearTimeout(timer)
                if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                    reject(
                        new OfficeConversionError(
                            `LibreOffice binary not found (looked for "${SOFFICE_BINARY}")`,
                            "SOFFICE_NOT_FOUND",
                        ),
                    )
                    return
                }
                reject(new OfficeConversionError(err.message, "CONVERSION_FAILED"))
            })
            proc.on("close", code => {
                clearTimeout(timer)
                if (code === 0) {
                    resolve()
                } else {
                    logger.error("[OfficeConversion] soffice exited non-zero", {
                        code,
                        stderr: stderr.slice(-2000),
                        stdout: stdout.slice(-2000),
                    })
                    reject(
                        new OfficeConversionError(
                            `LibreOffice exited with code ${code}`,
                            "CONVERSION_FAILED",
                        ),
                    )
                }
            })
        }))

        const result = await readFile(outputPath)

        await writeGcsCache(gcsPath, result, contentHash)

        return result
    } finally {
        await rm(workDir, { recursive: true, force: true }).catch(err => {
            logger.warn("[OfficeConversion] Failed to clean up temp dir", {
                workDir,
                error: err instanceof Error ? err.message : String(err),
            })
        })
        await storageService.deleteFile(inputGcsKey).catch(err => {
            logger.warn("[OfficeConversion] Failed to clean up temp GCS input object", {
                inputGcsKey,
                error: err instanceof Error ? err.message : String(err),
            })
        })
    }
}
