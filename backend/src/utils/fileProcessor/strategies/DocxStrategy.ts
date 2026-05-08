import { BaseStrategy } from "./BaseStrategy"
import type { ProcessingResult, StrategyConfig } from "../types"
import JSZip from "jszip"
import { XMLParser } from "fast-xml-parser"

// Symbol character mapping for special fonts
const SYMBOL_MAPPINGS: { [font: string]: { [char: string]: string } } = {
    Wingdings: {
        "21": "☎", "22": "✉", "23": "📁", "24": "📂", "25": "🗂", "26": "⌚", "27": "⏰", "28": "📞", "29": "📠", "2A": "💻",
        "2B": "🖱", "2C": "⌨", "2D": "🖨", "2E": "📧", "2F": "🌐", "30": "🔒", "31": "🔓", "32": "🔑", "33": "✂", "34": "✏",
        "35": "✒", "36": "📝", "37": "📋", "38": "📌", "39": "📎", "3A": "🔗", "3B": "⚡", "3C": "☀", "3D": "☁", "3E": "☂",
        "3F": "❄", "40": "⭐", "41": "🌙", "42": "🔥", "43": "💧", "44": "🌍", "45": "🌱", "46": "🌳", "47": "🌸", "48": "🌺",
        "49": "🍀", "4A": "🐝", "4B": "🦋", "4C": "🐛", "4D": "🐾", "4E": "👤", "4F": "👥", "50": "👨", "51": "👩", "52": "👶",
        "53": "👴", "54": "👵", "55": "💼", "56": "🎓", "57": "🏠", "58": "🏢", "59": "🏥", "5A": "🏫", "5B": "🏪", "5C": "🚗",
        "5D": "✈", "5E": "🚢", "5F": "🚂", "60": "🚲", "61": "⚽", "62": "🏀", "63": "🎾", "64": "⚾", "65": "🏈", "66": "🎯",
        "67": "🎮", "68": "🎲", "69": "🃏", "6A": "🎭", "6B": "🎨", "6C": "🎵", "6D": "🎶", "6E": "📻", "6F": "📺", "70": "📷",
        "71": "📹", "72": "💿", "73": "💾", "74": "💽", "75": "📀", "76": "🔊", "77": "🔇", "78": "📢", "79": "📣", "7A": "🔔",
        "7B": "🔕", "7C": "📯", "7D": "🎺", "7E": "🎸", "7F": "🎹", "80": "🥁", "81": "🎤", "82": "🎧", "83": "📱", "84": "☎",
        "85": "📞", "86": "📟", "87": "📠", "88": "💻", "89": "🖥", "8A": "⌨", "8B": "🖱", "8C": "🖨", "8D": "💾", "8E": "💿",
        "8F": "📀", "90": "💽", "91": "💾", "92": "🗃", "93": "🗂", "94": "📋", "95": "📊", "96": "📈", "97": "📉", "98": "📇",
        "99": "🗃", "9A": "🗄", "9B": "📁", "9C": "📂", "9D": "🗂", "9E": "📑", "9F": "📄", A0: "📃", A1: "📜", A2: "📰",
        A3: "🗞", A4: "📓", A5: "📔", A6: "📒", A7: "📕", A8: "📗", A9: "📘", AA: "📙", AB: "📚", AC: "📖", AD: "🔖", AE: "🏷",
        AF: "💰", B0: "💴", B1: "💵", B2: "💶", B3: "💷", B4: "💸", B5: "💳", B6: "💎", B7: "⚖", B8: "🔧", B9: "🔨", BA: "⚒",
        BB: "🛠", BC: "⛏", BD: "🔩", BE: "⚙", BF: "⚗", C0: "🔬", C1: "🔭", C2: "📡", C3: "💉", C4: "💊", C5: "🩹", C6: "🩺",
        C7: "🔬", C8: "🧪", C9: "🧬", CA: "🦠", CB: "💀", CC: "☠", CD: "👻", CE: "👽", CF: "🤖", D0: "🎃", D1: "😈", D2: "👿",
        D3: "👹", D4: "👺", D5: "💩", D6: "🤡", D7: "👻", D8: "💀", D9: "☠", DA: "👽", DB: "🤖", DC: "🎭", DD: "🎨", DE: "🎪",
        DF: "🎢", E0: "🎡", E1: "🎠", E2: "🎪", E3: "🎭", E4: "🎨", E5: "🎬", E6: "🎤", E7: "🎧", E8: "🎼", E9: "🎵", EA: "🎶",
        EB: "🎹", EC: "🥁", ED: "🎷", EE: "🎺", EF: "🎸", F0: "🎻", F1: "🎲", F2: "🎯", F3: "🎳", F4: "🎮", F5: "🕹", F6: "🎰",
        F7: "🃏", F8: "🀄", F9: "🎴", FA: "🎊", FB: "🎉", FC: "🎈", FD: "🎁", FE: "🎀", FF: "🎗",
    },
    Symbol: {
        "21": "!", "22": "∀", "23": "#", "24": "∃", "25": "%", "26": "&", "27": "∋", "28": "(", "29": ")", "2A": "∗",
        "2B": "+", "2C": ",", "2D": "−", "2E": ".", "2F": "/", "30": "0", "31": "1", "32": "2", "33": "3", "34": "4",
        "35": "5", "36": "6", "37": "7", "38": "8", "39": "9", "3A": ":", "3B": ";", "3C": "<", "3D": "=", "3E": ">",
        "3F": "?", "40": "≅", "41": "Α", "42": "Β", "43": "Χ", "44": "Δ", "45": "Ε", "46": "Φ", "47": "Γ", "48": "Η",
        "49": "Ι", "4A": "ϑ", "4B": "Κ", "4C": "Λ", "4D": "Μ", "4E": "Ν", "4F": "Ο", "50": "Π", "51": "Θ", "52": "Ρ",
        "53": "Σ", "54": "Τ", "55": "Υ", "56": "ς", "57": "Ω", "58": "Ξ", "59": "Ψ", "5A": "Ζ", "5B": "[", "5C": "∴",
        "5D": "]", "5E": "⊥", "5F": "_", "60": "‾", "61": "α", "62": "β", "63": "χ", "64": "δ", "65": "ε", "66": "φ",
        "67": "γ", "68": "η", "69": "ι", "6A": "ϕ", "6B": "κ", "6C": "λ", "6D": "μ", "6E": "ν", "6F": "ο", "70": "π",
        "71": "θ", "72": "ρ", "73": "σ", "74": "τ", "75": "υ", "76": "ϖ", "77": "ω", "78": "ξ", "79": "ψ", "7A": "ζ",
        "7B": "{", "7C": "|", "7D": "}", "7E": "∼", A0: "€", A1: "ϒ", A2: "′", A3: "≤", A4: "⁄", A5: "∞", A6: "ƒ",
        A7: "♣", A8: "♦", A9: "♥", AA: "♠", AB: "↔", AC: "←", AD: "↑", AE: "→", AF: "↓", B0: "°", B1: "±", B2: "″",
        B3: "≥", B4: "×", B5: "propto", B6: "partial", B7: "bul", B8: "div", B9: "ne", BA: "equiv", BB: "approx",
        BC: "...", BD: "vertical", BE: "vertical", BF: "downleft", C0: "aleph", C1: "imag", C2: "real", C3: "weier",
        C4: "times", C5: "plus", C6: "empty", C7: "cap", C8: "cup", C9: "supset", CA: "supseteq", CB: "notsubset",
        CC: "subset", CD: "subseteq", CE: "in", CF: "notin", D0: "angle", D1: "nabla", D2: "reg", D3: "copy", D4: "trade",
        D5: "prod", D6: "surd", D7: "dot", D8: "not", D9: "and", DA: "or", DB: "hArr", DC: "lArr", DD: "uArr", DE: "rArr",
        DF: "dArr", E0: "lozenge", E1: "lang", E2: "reg", E3: "copy", E4: "trade", E5: "sum", E6: "parenlefttp",
        E7: "parenleftex", E8: "parenleftbt", E9: "bracketlefttp", EA: "bracketleftex", EB: "bracketleftbt",
        EC: "bracelefttp", ED: "braceleftmid", EE: "braceleftbt", EF: "braceex", F0: "bracerighttp", F1: "bracerightmid",
        F2: "bracerightbt", F3: "bracketrighttp", F4: "bracketrightex", F5: "bracketrightbt", F6: "parenrighttp",
        F7: "parenrightex", F8: "parenrightbt", F9: "rang", FA: "int", FB: "integertp", FC: "integerbt", FD: "integerex",
        FE: "horizontal", FF: "integerex",
    },
}


export class DocxStrategy extends BaseStrategy {
    private config: Required<Pick<StrategyConfig, "chunkSize" | "chunkOverlap">>
    private parser: XMLParser

    constructor(config?: StrategyConfig) {
        super()
        this.config = {
            chunkSize: config?.chunkSize ?? 1000,
            chunkOverlap: config?.chunkOverlap ?? 200,
        }
        this.parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            textNodeName: "#text",
            trimValues: false,
        })
    }

    async parse(buffer: Buffer, _vespaDocId: string): Promise<ProcessingResult> {
        try {
            const zip = await JSZip.loadAsync(buffer)

            const documentXml = await zip.file("word/document.xml")?.async("text")
            if (!documentXml) {
                throw new Error("Could not find word/document.xml")
            }

            const documentData = this.parser.parse(documentXml)
            const body = documentData["w:document"]?.["w:body"]
            if (!body) throw new Error("Document body missing")

            // Relationships for hyperlinks
            const relsXml = await zip.file("word/_rels/document.xml.rels")?.async("text")
            if (relsXml) {
                const relsData = this.parser.parse(relsXml)
                documentData.__rels = this.parseRelationships(relsData)
            }

            const allParagraphs: string[] = []

            // Extract footnotes and endnotes if available
            const footnotes = await this.extractNotes(zip, "word/footnotes.xml", "w:footnotes", "w:footnote")
            const endnotes = await this.extractNotes(zip, "word/endnotes.xml", "w:endnotes", "w:endnote")

            // Process main body elements
            const contentElements = this.getContentElements(body, documentXml)

            for (const item of contentElements) {
                if (item.type === "w:p") {
                    const text = this.extractTextFromParagraph(item.element)
                    if (text.trim()) allParagraphs.push(text)
                } else if (item.type === "w:tbl") {
                    const tableText = this.extractTextFromTable(item.element)
                    if (tableText.trim()) allParagraphs.push(tableText)
                }
            }

            if (footnotes) allParagraphs.push(...footnotes.split("\n\n"))
            if (endnotes) allParagraphs.push(...endnotes.split("\n\n"))

            const chunks = this.chunkByParagraphs(allParagraphs)

            return {
                chunks,
                processingMethod: this.getName(),
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`Docx parsing failed: ${message}`)
        }
    }

    private getContentElements(body: any, bodyXml: string): any[] {
        const elements: any[] = []

        const tags = [
            { type: "w:p", regex: /<w:p[\s>]/g },
            { type: "w:tbl", regex: /<w:tbl[\s>]/g }
        ]

        for (const tag of tags) {
            const items = Array.isArray(body[tag.type]) ? body[tag.type] : (body[tag.type] ? [body[tag.type]] : [])
            let matchIdx = 0
            let match
            while ((match = tag.regex.exec(bodyXml)) !== null && matchIdx < items.length) {
                elements.push({
                    type: tag.type,
                    position: match.index,
                    element: items[matchIdx++]
                })
            }
        }

        return elements.sort((a, b) => a.position - b.position)
    }

    private extractTextFromParagraph(p: any): string {
        const parts: string[] = []

        const numPr = p["w:pPr"]?.["w:numPr"]
        const ilvl = numPr?.["w:ilvl"]?.["@_w:val"]
        const prefix = ilvl !== undefined ? "  ".repeat(parseInt(ilvl)) + "- " : ""

        const runs = Array.isArray(p["w:r"]) ? p["w:r"] : (p["w:r"] ? [p["w:r"]] : [])
        for (const r of runs) {
            const t = r["w:t"]
            const textVal = typeof t === "string" ? t : t?.["#text"]
            if (textVal) parts.push(textVal)

            if (r["w:sym"]) parts.push(this.readSymbol(r["w:sym"]))
            if (r["w:br"]) parts.push("\n")
        }

        const mathText = this.extractMath(p)
        if (mathText) parts.push(mathText)

        return prefix + parts.join("")
    }

    private extractMath(p: any): string {
        let mathStr = ""
        const findMath = (obj: any) => {
            if (!obj || typeof obj !== "object") return
            if (obj["m:oMath"] || obj["m:oMathPara"]) {
                const math = obj["m:oMath"] || obj["m:oMathPara"]
                mathStr += ` [MATH: ${this.serializeMath(math)}] `
            }
            for (const k in obj) findMath(obj[k])
        }
        findMath(p)
        return mathStr.trim()
    }

    private serializeMath(math: any): string {
        let t = ""
        const traverse = (o: any) => {
            if (!o) return
            if (typeof o["w:t"] === "string") t += o["w:t"]
            if (typeof o["#text"] === "string") t += o["#text"]
            for (const k in o) if (typeof o[k] === "object") traverse(o[k])
        }
        traverse(math)
        return t.trim()
    }

    private readSymbol(sym: any): string {
        const font = sym["@_w:font"]
        let char = sym["@_w:char"]?.toUpperCase()
        if (char?.startsWith("F0")) char = char.substring(2)
        return SYMBOL_MAPPINGS[font]?.[char] || `[SYM:${font}:${char}]`
    }

    private extractTextFromTable(tbl: any): string {
        const rows = Array.isArray(tbl["w:tr"]) ? tbl["w:tr"] : (tbl["w:tr"] ? [tbl["w:tr"]] : [])
        const tableLines: string[] = []

        for (const row of rows) {
            const cells = Array.isArray(row["w:tc"]) ? row["w:tc"] : (row["w:tc"] ? [row["w:tc"]] : [])
            const rowContent = cells.map((cell: any) => {
                const paragraphs = Array.isArray(cell["w:p"]) ? cell["w:p"] : (cell["w:p"] ? [cell["w:p"]] : [])
                return paragraphs.map((p: any) => this.extractTextFromParagraph(p)).join(" ").trim()
            })
            tableLines.push(rowContent.join(" | "))
        }
        return tableLines.join("\n")
    }

    private async extractNotes(zip: JSZip, path: string, rootTag: string, itemTag: string): Promise<string> {
        const xml = await zip.file(path)?.async("text")
        if (!xml) return ""
        const data = this.parser.parse(xml)
        const items = Array.isArray(data[rootTag]?.[itemTag]) ? data[rootTag][itemTag] : (data[rootTag]?.[itemTag] ? [data[rootTag][itemTag]] : [])

        return items
            .filter((i: any) => i["@_w:id"] && i["@_w:id"] !== "-1" && i["@_w:id"] !== "0")
            .map((i: any) => {
                const ps = Array.isArray(i["w:p"]) ? i["w:p"] : [i["w:p"]]
                return `[^${i["@_w:id"]}]: ` + ps.map((p: any) => this.extractTextFromParagraph(p)).join(" ")
            })
            .join("\n\n")
    }

    private parseRelationships(relsData: any): Map<string, string> {
        const map = new Map<string, string>()
        const rels = Array.isArray(relsData.Relationships?.Relationship) ? relsData.Relationships.Relationship : [relsData.Relationships?.Relationship]
        for (const r of rels) if (r?.["@_Id"]) map.set(r["@_Id"], r["@_Target"])
        return map
    }

    private chunkByParagraphs(paragraphs: string[]): string[] {
        const chunks: string[] = []
        let currentChunk = ""
        const { chunkSize } = this.config

        for (const para of paragraphs) {
            if (currentChunk.length + para.length + 2 > chunkSize && currentChunk.length > 0) {
                chunks.push(currentChunk.trim())
                currentChunk = ""
            }
            currentChunk += (currentChunk ? "\n\n" : "") + para
        }
        if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim())
        return chunks
    }

    getName(): string {
        return "docx-smart"
    }
}
