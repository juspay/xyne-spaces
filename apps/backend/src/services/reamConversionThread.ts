/**
 * Body of each Ream conversion thread, started by reamConversionPool.ts (from
 * this .ts under tsx in dev, from the compiled .js in dist/ in production, the
 * same way migration/self-serve/index.ts starts workerMain).
 *
 * Takes a document's bytes and answers with its PDF or an error message. The
 * thread keeps Ream and the fonts it has loaded between conversions.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { parentPort, workerData } from "node:worker_threads"
import { Ream } from "reamkit"

export type ThreadRequest = { bytes: Uint8Array }
export type ThreadResponse = { ok: true; pdf: Uint8Array } | { ok: false; message: string }
/** Sent once, after this module and Ream have loaded: the thread can take work. */
export type ThreadReady = { ready: true }
export type ThreadData = { fontDir: string }

const port = parentPort
if (!port) throw new Error("reamConversionThread must run as a worker thread")

// Ream asks for its substitute fonts by CDN URL. Answer from the copies in
// fontDir instead, so a conversion never touches the network: a font that is
// not there is a 404, which Ream records as a loss and draws as boxes.
const FONT_CDN = "https://cdn.jsdelivr.net/npm/@expo-google-fonts/"
const { fontDir } = workerData as ThreadData

async function fontFetch(url: string): Promise<Response> {
    const rel = url.startsWith(FONT_CDN) ? url.slice(FONT_CDN.length) : ""
    const file = path.resolve(fontDir, rel)
    if (!rel || !file.startsWith(fontDir + path.sep)) return new Response(null, { status: 404 })
    try {
        return new Response(await readFile(file))
    } catch {
        return new Response(null, { status: 404 })
    }
}

port.on("message", async ({ bytes }: ThreadRequest) => {
    let response: ThreadResponse
    try {
        // 'libreoffice' breaks and stacks lines the way the previews used to look.
        const pdf = await Ream.parse(new Uint8Array(bytes)).convert("pdf", { layoutProfile: "libreoffice", fontFetch })
        response = { ok: true, pdf }
    } catch (err) {
        response = { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
    port.postMessage(response)
})

port.postMessage({ ready: true } satisfies ThreadReady)
