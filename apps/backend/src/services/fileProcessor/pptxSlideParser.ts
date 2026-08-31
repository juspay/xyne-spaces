import JSZip from "jszip"
import { XMLParser } from "fast-xml-parser"

/**
 * Low-level PPTX (OOXML) parser for PptxStrategy's text extraction (Vespa
 * ingestion) — its only consumer. PPTX is a ZIP of XML, same family as DOCX —
 * this mirrors DocxStrategy's JSZip + fast-xml-parser approach, just walking
 * ppt/slides/slideN.xml's DrawingML shape tree instead of word/document.xml's
 * WordprocessingML paragraph tree.
 *
 * Only extracts what PptxStrategy reads: each shape's text runs, its
 * placeholder type (title vs body), and slide ordering. Image/geometry/fill
 * extraction was removed — nothing in this branch consumed it (see XYNE-60825
 * PR review); reintroduce that alongside whatever feature actually needs it
 * (e.g. a native slide-viewer), rather than speculatively.
 */

function asArray<T>(value: T | T[] | undefined): T[] {
    if (value == null) return []
    return Array.isArray(value) ? value : [value]
}

export interface ParsedTextRun {
    text: string
}

export interface ParsedShape {
    kind: "text"
    /** OOXML placeholder type, e.g. "title" | "ctrTitle" | "subTitle" | "body" — absent for non-placeholder shapes */
    placeholderType?: string
    /** One entry per paragraph in the shape's text body */
    runs: ParsedTextRun[]
}

export interface ParsedSlide {
    /** 1-based, in presentation (display) order */
    index: number
    shapes: ParsedShape[]
}

export interface ParsedPptx {
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

/**
 * Resolve r:id -> target path for a part, from its sibling _rels/*.rels file.
 * Only used for ppt/presentation.xml's slide-id relationships (slide
 * ordering) — per-slide rels (media embeds) aren't read since shapes' image
 * data isn't extracted.
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

/** Resolve a relationship target (possibly relative, e.g. "../slides/slide1.xml") against its part's directory. */
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
        let text = ""
        for (const r of rNodes) {
            const t = r?.t
            text += typeof t === "string" ? t : (t?.["#text"] ?? "")
        }
        if (text.trim().length > 0) runs.push({ text })
    }
    return runs
}

async function parseSlideXml(zip: JSZip, slideXmlPath: string, slideIndex: number): Promise<ParsedSlide> {
    const xmlFile = zip.file(slideXmlPath)
    if (!xmlFile) return { index: slideIndex, shapes: [] }
    const xml = await xmlFile.async("text")
    const parsed = xmlParser.parse(xml)

    const spTree = parsed?.sld?.cSld?.spTree
    const shapes: ParsedShape[] = []

    for (const sp of asArray(spTree?.sp)) {
        const placeholderType: string | undefined = sp?.nvSpPr?.nvPr?.ph?.["@_type"]
        const runs = extractRunsFromTxBody(sp?.txBody)
        if (runs.length > 0) {
            shapes.push({
                kind: "text",
                ...(placeholderType && { placeholderType }),
                runs,
            })
        }
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

    // Namespace-preserved parse just for the slide id list: <p:sldId
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

    return { slides }
}
