import { createHash } from "crypto"
import { XMLBuilder, XMLParser } from "fast-xml-parser"
import JSZip from "jszip"
import { logger } from "@/utils/logger"
import { storageService } from "@/services/storage"
import { isPreconditionFailed } from "@xyne/storage"
import { convertWithReam, ReamConversionThreadError } from "@/services/reamConversionPool"

/**
 * Converts an office document (pptx, docx, xlsx, ...) to PDF with Ream, a pure
 * JavaScript renderer (see reamConversionPool.ts). It replaced LibreOffice when
 * the runtime went distroless: no shell, no other program to start. The PDF is
 * what every previewer draws and what the OCR pipeline reads.
 */

// Cached in GCS (the same bucket every other upload in this app already
// uses), keyed on the content hash — this endpoint is stateless (no
// file/collection id, just bytes), so content is the only key available.
// Content-addressed and immutable, so entries never need to expire. The
// renderer and its patch level are part of the prefix: a different renderer
// draws the same bytes differently, so its PDFs must not be served for it.
const GCS_CACHE_PREFIX = "office-conversion-cache/reamkit-1.33.1-p2"

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
// OLE objects, external chart data sources, remote template refs. A renderer
// that resolves those fetches or reads them server-side and draws the result
// into the PDF: SSRF and local file disclosure from a well-formed document
// (Slack's 2019 unoconv incident). Ream does not fetch them, but neutralizing
// every External relationship's Target leaves no URL or file path in the
// package for any renderer — this one, or a later one — to resolve.
//
// This covers the OPC-relationship mechanism (modern .pptx/.docx/.xlsx), not
// the legacy binary .ppt/.doc/.xls containers, whose linked-object references
// live in compound-file streams. Non-zip input falls through unchanged below.
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
                // would take a renderer outside the package.
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
        public readonly code: "TIMEOUT" | "CONVERSION_FAILED",
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

    const sanitizedBuffer = await stripExternalReferences(buffer, contentHash, originalFilename)
    let result: Buffer
    try {
        result = await convertWithReam(sanitizedBuffer)
    } catch (err) {
        const timedOut = err instanceof ReamConversionThreadError && err.code === "TIMEOUT"
        logger.error("[OfficeConversion] Ream conversion failed", {
            contentHash,
            originalFilename,
            error: err instanceof Error ? err.message : String(err),
        })
        throw new OfficeConversionError(
            timedOut ? "Conversion timed out" : "Conversion failed",
            timedOut ? "TIMEOUT" : "CONVERSION_FAILED",
        )
    }

    await writeGcsCache(gcsPath, result, contentHash)

    return result
}
