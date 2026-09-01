import { spawn } from "child_process"
import { createHash } from "crypto"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
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

// Two-tier cache, both keyed on the content hash (this endpoint is
// stateless — no file/collection id, just bytes, so content is the only key
// available):
//   1. Local disk — near-zero latency, but wiped on pod restart and not
//      shared across replicas.
//   2. GCS (the same bucket every other upload in this app already uses) —
//      survives restarts and is shared across every backend replica, at the
//      cost of a network round trip instead of a local read.
// A hit on tier 2 backfills tier 1, so a given pod only pays the GCS latency
// once per content hash.
const CACHE_DIR = path.join(tmpdir(), "office-conversion-cache")
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const GCS_CACHE_PREFIX = "office-conversion-cache"

export class OfficeConversionError extends Error {
    constructor(
        message: string,
        public readonly code: "SOFFICE_NOT_FOUND" | "TIMEOUT" | "CONVERSION_FAILED",
    ) {
        super(message)
        this.name = "OfficeConversionError"
    }
}

async function readLocalCache(cachePath: string): Promise<Buffer | null> {
    try {
        const stats = await stat(cachePath)
        if (Date.now() - stats.mtimeMs > CACHE_MAX_AGE_MS) return null
        return await readFile(cachePath)
    } catch {
        return null
    }
}

async function writeLocalCache(cachePath: string, buffer: Buffer, contentHash: string): Promise<void> {
    await mkdir(CACHE_DIR, { recursive: true })
        .then(() => writeFile(cachePath, buffer))
        .catch(err => {
            logger.warn("[OfficeConversion] Failed to write local cache entry", {
                contentHash,
                error: err instanceof Error ? err.message : String(err),
            })
        })
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

export async function convertToPdf(buffer: Buffer, originalFilename: string): Promise<Buffer> {
    const contentHash = createHash("sha256").update(buffer).digest("hex")
    const cachePath = path.join(CACHE_DIR, `${contentHash}.pdf`)
    const gcsPath = `${GCS_CACHE_PREFIX}/${contentHash}.pdf`

    const localHit = await readLocalCache(cachePath)
    if (localHit) {
        logger.info("[OfficeConversion] Local cache hit", { contentHash })
        return localHit
    }

    const gcsHit = await readGcsCache(gcsPath)
    if (gcsHit) {
        logger.info("[OfficeConversion] GCS cache hit", { contentHash })
        await writeLocalCache(cachePath, gcsHit, contentHash)
        return gcsHit
    }

    const workDir = await mkdtemp(path.join(tmpdir(), "office-convert-"))
    const profileDir = path.join(workDir, "profile")
    const ext = path.extname(originalFilename) || ".bin"
    const inputPath = path.join(workDir, `input${ext}`)
    const outputPath = path.join(workDir, "input.pdf")

    try {
        await writeFile(inputPath, buffer)

        await new Promise<void>((resolve, reject) => {
            const args = [
                "--headless",
                "--norestore",
                `-env:UserInstallation=file://${profileDir}`,
                "--convert-to",
                "pdf",
                "--outdir",
                workDir,
                inputPath,
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
        })

        const result = await readFile(outputPath)

        await Promise.all([
            writeLocalCache(cachePath, result, contentHash),
            writeGcsCache(gcsPath, result, contentHash),
        ])

        return result
    } finally {
        await rm(workDir, { recursive: true, force: true }).catch(err => {
            logger.warn("[OfficeConversion] Failed to clean up temp dir", {
                workDir,
                error: err instanceof Error ? err.message : String(err),
            })
        })
    }
}

