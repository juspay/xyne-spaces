import { spawn } from "child_process"
import { createHash } from "crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { XMLBuilder, XMLParser } from "fast-xml-parser"
import JSZip from "jszip"
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

// Untrusted documents can carry external "links" — linked images/OLE
// objects, remote template refs — that LibreOffice resolves by default
// when it opens a file, even in headless --convert-to mode. That resolution
// is a real, exploited-in-the-wild bug class: Slack's 2019 unoconv incident
// used exactly this (a linked object pointing at an internal/metadata URL,
// or a file:// path) to get soffice to fetch/read content server-side and
// render it back into the output PDF — SSRF and local file disclosure via
// a perfectly well-formed document, no parser bug or macro needed.
//
// There's no --convert-to CLI flag for this (the fix is the UNO API's
// UpdateDocMode=NO_UPDATE, only settable via scripting) — but each
// conversion already gets a fresh, throwaway profile dir via
// -env:UserInstallation, so seeding that profile's registrymodifications.xml
// before soffice starts achieves the same thing: link/field updates and
// macro execution are switched off before the document is ever opened.
const HARDENED_PROFILE_REGISTRY = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateLinksOnLoad" oor:op="fuse"><value>0</value></prop></item>
 <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
 <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
</oor:items>
`

async function seedHardenedProfile(profileDir: string): Promise<void> {
    const userDir = path.join(profileDir, "user")
    await mkdir(userDir, { recursive: true })
    await writeFile(path.join(userDir, "registrymodifications.xml"), HARDENED_PROFILE_REGISTRY)
}

function asArray<T>(value: T | T[] | undefined): T[] {
    if (value == null) return []
    return Array.isArray(value) ? value : [value]
}

const RELS_XML_PARSER = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" })
const RELS_XML_BUILDER = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    suppressEmptyNode: true,
})

// Modern Office formats (pptx/docx/xlsx) are zips whose *.rels parts declare
// every external reference a document part can carry — linked images, linked
// OLE objects, external chart data sources, remote template refs. This is
// the exact mechanism the registry hardening above defends against (Slack's
// 2019 unoconv SSRF/LFD incident), but that hardening relies on trusting
// which of LibreOffice's internal resolution paths a given registry key
// actually governs — and testing against our own hand-built PoC couldn't
// confirm that for every link type. Neutralizing every External
// relationship's Target here is a stronger, more directly verifiable
// guarantee: there is no URL/file path left anywhere in the package for any
// LibreOffice code path — known or not yet discovered — to resolve.
//
// Complementary to, not a replacement for, the registry hardening: this only
// covers the OPC-relationship mechanism (modern .pptx/.docx/.xlsx), not
// legacy binary .ppt/.doc/.xls (a completely different, non-zip container
// format where "linked object" references live in binary compound-file
// streams instead). Non-zip input falls through unchanged below — the
// registry hardening is what still covers that case.
interface StrippedReference {
    part: string
    relationshipId: string
    type: string
    target: string
}

async function stripExternalReferences(
    buffer: Buffer,
    contentHash: string,
    originalFilename: string,
): Promise<Buffer> {
    let zip: JSZip
    try {
        zip = await JSZip.loadAsync(buffer)
    } catch {
        return buffer
    }

    let changed = false
    const stripped: StrippedReference[] = []
    const relsFiles = zip.file(/\.rels$/)

    for (const entry of relsFiles) {
        const xml = await entry.async("text")
        let parsed: Record<string, unknown>
        try {
            parsed = RELS_XML_PARSER.parse(xml)
        } catch {
            continue
        }

        const relationshipsNode = (parsed?.Relationships as Record<string, unknown>)?.Relationship
        const relationships = asArray(relationshipsNode as Record<string, string> | Record<string, string>[])
        if (relationships.length === 0) continue

        let fileChanged = false
        for (const rel of relationships) {
            if (rel["@_TargetMode"] === "External") {
                // Every relationship type (image, oleObject, attachedTemplate,
                // externalLinkPath, ...) carries its outbound reference the
                // same way, so this isn't filtered by @_Type — anything
                // TargetMode="External" is, by definition, a reference that
                // would take soffice outside the package.
                stripped.push({
                    part: entry.name,
                    relationshipId: rel["@_Id"] ?? "",
                    type: (rel["@_Type"] ?? "").split("/").pop() ?? rel["@_Type"] ?? "",
                    target: rel["@_Target"] ?? "",
                })
                rel["@_Target"] = ""
                delete rel["@_TargetMode"]
                fileChanged = true
            }
        }
        if (!fileChanged) continue

        ;(parsed.Relationships as Record<string, unknown>).Relationship = relationships
        zip.file(entry.name, RELS_XML_BUILDER.build(parsed) as string)
        changed = true
    }

    if (!changed) return buffer

    // Compliance/audit trail — every uploaded document that shipped an
    // external reference, with enough detail (which part, what kind, what it
    // pointed at) to answer "did we ever process a file that tried to reach
    // <url>" after the fact, not just "sanitization ran."
    logger.warn("[OfficeConversion] Stripped external references before conversion", {
        contentHash,
        originalFilename,
        strippedCount: stripped.length,
        stripped,
    })

    // Match the original archive's DEFLATE compression — the default
    // (STORE, uncompressed) would otherwise silently bloat every sanitized
    // file by ~3x on its way into the GCS cache.
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
}

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
    // (path separators, "..", null bytes, ...) can influence where
    // inputPath actually lands on disk.
    const rawExt = path.extname(originalFilename)
    const ext = /^\.[a-zA-Z0-9]{1,10}$/.test(rawExt) ? rawExt : ".bin"
    const inputPath = path.join(workDir, `input${ext}`)
    const outputPath = path.join(workDir, "input.pdf")

    try {
        const sanitizedBuffer = await stripExternalReferences(buffer, contentHash, originalFilename)
        await writeFile(inputPath, sanitizedBuffer)
        await seedHardenedProfile(profileDir)

        await conversionLimit(() => new Promise<void>((resolve, reject) => {
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
    }
}
