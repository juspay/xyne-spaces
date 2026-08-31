import JSZip from "jszip"
import { XMLParser } from "fast-xml-parser"

/**
 * Low-level PPTX (OOXML) parser shared by PptxStrategy (text extraction for
 * Vespa ingestion) and collectionController's slide-viewer endpoint (visual
 * rendering). PPTX is a ZIP of XML, same family as DOCX — this mirrors
 * DocxStrategy's JSZip + fast-xml-parser approach, just walking
 * ppt/slides/slideN.xml's DrawingML shape tree instead of
 * word/document.xml's WordprocessingML paragraph tree.
 *
 * Positions/sizes are returned in raw EMU (English Metric Units, OOXML's
 * native unit — 914400 EMU per inch) alongside the slide's own EMU
 * dimensions, so callers can convert to whatever target canvas they need
 * rather than baking in an assumption here.
 */

const EMU_PER_INCH = 914400

export interface ParsedTextRun {
    text: string
    bold?: boolean
    italic?: boolean
    /** 6-hex-digit RGB, no '#' prefix (matches OOXML's <a:srgbClr val="RRGGBB"/> directly) */
    color?: string
    /** Points */
    fontSize?: number
    bullet?: boolean
}

export interface ParsedShape {
    kind: "text" | "image"
    /** OOXML placeholder type, e.g. "title" | "ctrTitle" | "subTitle" | "body" — absent for non-placeholder shapes */
    placeholderType?: string
    /** One entry per paragraph in the shape's text body */
    runs?: ParsedTextRun[]
    /** EMU */
    x?: number
    y?: number
    w?: number
    h?: number
    /** 6-hex-digit RGB, no '#' prefix */
    fillColor?: string
    image?: { base64: string; mimeType: string }
}

export interface ParsedSlide {
    /** 1-based, in presentation (display) order */
    index: number
    shapes: ParsedShape[]
}

export interface ParsedPptx {
    /** EMU */
    slideWidthEmu: number
    /** EMU */
    slideHeightEmu: number
    slides: ParsedSlide[]
}

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: false,
    removeNSPrefix: true,
    processEntities: {
        maxTotalExpansions: 10000,
        maxEntityCount: 1000,
    },
})

// A second parser WITHOUT namespace stripping, used only for
// ppt/presentation.xml's <p:sldId id="256" r:id="rId2"/> — its plain `id`
// (the slide's own numeric id) and namespaced `r:id` (the relationship id
// we actually need) would otherwise collide onto the same `@_id` key once
// prefixes are stripped, silently picking whichever happened to parse last.
const nsAwareXmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: false,
    removeNSPrefix: false,
    processEntities: {
        maxTotalExpansions: 10000,
        maxEntityCount: 1000,
    },
})

function asArray<T>(value: T | T[] | undefined): T[] {
    if (value == null) return []
    return Array.isArray(value) ? value : [value]
}

const IMAGE_EXT_TO_MIME: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    bmp: "image/bmp",
    webp: "image/webp",
    tiff: "image/tiff",
    emf: "image/x-emf",
    wmf: "image/x-wmf",
}

/**
 * Resolve r:id -> target path for a part, from its sibling _rels/*.rels file.
 */
async function readRels(zip: JSZip, relsPath: string): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    const relsFile = zip.file(relsPath)
    if (!relsFile) return map
    const xml = await relsFile.async("text")
    const parsed = xmlParser.parse(xml)
    const relationships = asArray(parsed?.Relationships?.Relationship)
    for (const rel of relationships) {
        const id = rel?.["@_Id"]
        const target = rel?.["@_Target"]
        if (id && target) map.set(id, target)
    }
    return map
}

/** Resolve a relationship target (possibly relative, e.g. "../media/image1.png") against its part's directory. */
function resolveRelTarget(partDir: string, target: string): string {
    if (target.startsWith("/")) return target.slice(1)
    const parts = `${partDir}/${target}`.split("/")
    const resolved: string[] = []
    for (const part of parts) {
        if (part === "." || part === "") continue
        if (part === "..") resolved.pop()
        else resolved.push(part)
    }
    return resolved.join("/")
}

function extractRunsFromTxBody(txBody: any): ParsedTextRun[] {
    const runs: ParsedTextRun[] = []
    const paragraphs = asArray(txBody?.p)
    for (const p of paragraphs) {
        const rNodes = asArray(p?.r)
        const bullet = p?.pPr?.buChar != null || p?.pPr?.buAutoNum != null
        let text = ""
        let bold: boolean | undefined
        let italic: boolean | undefined
        let color: string | undefined
        let fontSize: number | undefined
        for (const r of rNodes) {
            const t = r?.t
            const runText = typeof t === "string" ? t : (t?.["#text"] ?? "")
            text += runText
            const rPr = r?.rPr
            if (rPr) {
                if (rPr["@_b"] === "1" || rPr["@_b"] === 1 || rPr["@_b"] === true) bold = true
                if (rPr["@_i"] === "1" || rPr["@_i"] === 1 || rPr["@_i"] === true) italic = true
                const sz = rPr["@_sz"]
                if (sz != null) fontSize = Number(sz) / 100 // OOXML sz is in hundredths of a point
                const srgb = rPr?.solidFill?.srgbClr?.["@_val"]
                if (srgb) color = String(srgb)
            }
        }
        if (text.trim().length > 0) {
            runs.push({
                text,
                ...(bold !== undefined && { bold }),
                ...(italic !== undefined && { italic }),
                ...(color !== undefined && { color }),
                ...(fontSize !== undefined && { fontSize }),
                ...(bullet && { bullet: true }),
            })
        }
    }
    return runs
}

function extractXfrm(spPr: any): { x?: number; y?: number; w?: number; h?: number } {
    const xfrm = spPr?.xfrm
    if (!xfrm) return {}
    const off = xfrm.off
    const ext = xfrm.ext
    return {
        ...(off?.["@_x"] != null && { x: Number(off["@_x"]) }),
        ...(off?.["@_y"] != null && { y: Number(off["@_y"]) }),
        ...(ext?.["@_cx"] != null && { w: Number(ext["@_cx"]) }),
        ...(ext?.["@_cy"] != null && { h: Number(ext["@_cy"]) }),
    }
}

function extractFillColor(spPr: any): string | undefined {
    const srgb = spPr?.solidFill?.srgbClr?.["@_val"]
    return srgb ? String(srgb) : undefined
}

async function parseSlideXml(
    zip: JSZip,
    slideXmlPath: string,
    slideIndex: number,
): Promise<ParsedSlide> {
    const xmlFile = zip.file(slideXmlPath)
    if (!xmlFile) return { index: slideIndex, shapes: [] }
    const xml = await xmlFile.async("text")
    const parsed = xmlParser.parse(xml)

    const relsPath = slideXmlPath.replace(/^(.*)\/([^/]+)$/, "$1/_rels/$2.rels")
    const rels = await readRels(zip, relsPath)
    const partDir = slideXmlPath.split("/").slice(0, -1).join("/")

    const spTree = parsed?.sld?.cSld?.spTree
    const shapes: ParsedShape[] = []

    for (const sp of asArray(spTree?.sp)) {
        const placeholderType: string | undefined = sp?.nvSpPr?.nvPr?.ph?.["@_type"]
        const runs = extractRunsFromTxBody(sp?.txBody)
        const { x, y, w, h } = extractXfrm(sp?.spPr)
        const fillColor = extractFillColor(sp?.spPr)
        if (runs.length > 0 || x !== undefined) {
            shapes.push({
                kind: "text",
                ...(placeholderType && { placeholderType }),
                runs,
                x,
                y,
                w,
                h,
                ...(fillColor && { fillColor }),
            })
        }
    }

    for (const pic of asArray(spTree?.pic)) {
        const embedId: string | undefined = pic?.blipFill?.blip?.["@_embed"]
        const { x, y, w, h } = extractXfrm(pic?.spPr)
        if (!embedId) continue
        const target = rels.get(embedId)
        if (!target) continue
        const mediaPath = resolveRelTarget(partDir, target)
        const mediaFile = zip.file(mediaPath)
        if (!mediaFile) continue
        const ext = mediaPath.split(".").pop()?.toLowerCase() ?? ""
        const mimeType = IMAGE_EXT_TO_MIME[ext]
        // Skip formats browsers can't render inline (EMF/WMF vector metafiles) —
        // they'd need their own conversion step; leaving the shape out entirely
        // is better than embedding a data URI the <img> tag can't decode.
        if (!mimeType || mimeType.startsWith("image/x-")) continue
        const base64 = await mediaFile.async("base64")
        shapes.push({ kind: "image", x, y, w, h, image: { base64, mimeType } })
    }

    return { index: slideIndex, shapes }
}

/**
 * Parse a PPTX buffer into per-slide shape data, in presentation (display)
 * order — resolved via ppt/presentation.xml's slide id list and its
 * relationship file, not by filename sort, since slideN.xml numbering isn't
 * guaranteed to match display order after slides are reordered.
 */
export async function parsePptxSlides(buffer: Buffer): Promise<ParsedPptx> {
    const zip = await JSZip.loadAsync(buffer)

    const presentationFile = zip.file("ppt/presentation.xml")
    if (!presentationFile) {
        throw new Error("ppt/presentation.xml not found in PPTX archive")
    }
    const presentationXml = await presentationFile.async("text")
    const presentation = xmlParser.parse(presentationXml)

    const sldSz = presentation?.presentation?.sldSz
    const slideWidthEmu = sldSz?.["@_cx"] != null ? Number(sldSz["@_cx"]) : 9144000 // 10in default
    const slideHeightEmu = sldSz?.["@_cy"] != null ? Number(sldSz["@_cy"]) : 6858000 // 7.5in default (4:3)

    // Namespace-preserved re-parse just for the slide id list: <p:sldId
    // id="256" r:id="rId2"/> has both a plain `id` (the slide's own numeric
    // id, unrelated) and a namespaced `r:id` (the relationship id we need) —
    // removeNSPrefix would collide them onto one `@_id` key.
    const presentationNsAware = nsAwareXmlParser.parse(presentationXml)
    const sldIds = asArray(presentationNsAware?.["p:presentation"]?.["p:sldIdLst"]?.["p:sldId"])

    const presentationRels = await readRels(zip, "ppt/_rels/presentation.xml.rels")

    const slides: ParsedSlide[] = []
    let index = 1
    for (const sldId of sldIds) {
        const relId: string | undefined = sldId?.["@_r:id"]
        const target = relId ? presentationRels.get(relId) : undefined
        if (!target) {
            index++
            continue
        }
        const slideXmlPath = resolveRelTarget("ppt", target)
        slides.push(await parseSlideXml(zip, slideXmlPath, index))
        index++
    }

    // Fallback: if the presentation.xml relationship walk found nothing
    // (unexpected structure), enumerate ppt/slides/slideN.xml directly —
    // correct in the common case, just not reorder-safe.
    if (slides.length === 0) {
        const slideFiles = Object.keys(zip.files)
            .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
            .sort((a, b) => {
                const numA = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
                const numB = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
                return numA - numB
            })
        let fallbackIndex = 1
        for (const path of slideFiles) {
            slides.push(await parseSlideXml(zip, path, fallbackIndex))
            fallbackIndex++
        }
    }

    return { slideWidthEmu, slideHeightEmu, slides }
}

export { EMU_PER_INCH }
