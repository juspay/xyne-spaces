/**
 * Parses a CSV buffer with columns: slide_number, public_slide_url
 * Each CSV is paired 1:1 with a PDF of the same base filename.
 * Returns a record of slideNumber → url.
 */
export function parseSlideUrlCsv(
    buffer: Buffer
): Record<string, string> {
    const text = buffer.toString("utf-8")
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)

    if (lines.length < 2) {
        return {}
    }

    // Skip header row
    const result: Record<string, string> = {}

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map(c => c.trim())
        if (cols.length < 2) continue

        const slideNumber = cols[0]
        const url = cols[1]

        if (!slideNumber || !url) continue
        if (isNaN(Number(slideNumber))) continue

        result[slideNumber] = url
    }

    return result
}
