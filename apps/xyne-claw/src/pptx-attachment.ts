/**
 * Inbound PPTX (MS PowerPoint) attachment ingest.
 *
 * PPTX is an OPC zip of XML parts. Slide text lives in
 * `ppt/slides/slide<N>.xml`; speaker notes live in
 * `ppt/notesSlides/notesSlide<N>.xml`. We extract <a:t> runs from each in
 * slide order, render as markdown headings ("## Slide N"), and write a
 * single combined file to `.context/<name>.pptx.md`.
 *
 * This is text-only — we don't extract embedded images/charts/tables. For
 * a goal that needs visual layout reasoning, the agent should still be
 * given keyframes or screenshots separately. For the common "summarize
 * the deck", "what does slide 7 say" use cases, text is plenty.
 *
 * Sibling of docx-attachment.ts, pdf-attachment.ts, xlsx-attachment.ts.
 */
import JSZip from "jszip";
import { matchesAttachmentType, PPTX_ATTACHMENT } from "xyne-claw-shared";

export const PPTX_EXTENSIONS = PPTX_ATTACHMENT.extensions;

export function isPptxAttachment(fileName: string, mimeType?: string | null): boolean {
  return matchesAttachmentType(fileName, mimeType, PPTX_ATTACHMENT.mimeTypes, PPTX_ATTACHMENT.extensions);
}

const MAX_SLIDES = 200;          // refuse > 200-slide decks; will note in footer
const MAX_OUTPUT_CHARS = 200_000;

/** Strip XML tags + collapse whitespace from a slide XML body. We only
 *  pull the visible run text (`<a:t>…</a:t>`), which is enough for the
 *  common case and keeps deck-extraction noise-free. */
function extractRunText(xml: string): string {
  const runs: string[] = [];
  const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const decoded = (m[1] ?? "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    if (decoded.trim().length > 0) runs.push(decoded);
  }
  return runs.join(" ").replace(/\s+/g, " ").trim();
}

function slideNumberOf(path: string): number {
  // ppt/slides/slide12.xml → 12
  const m = path.match(/slide(\d+)\.xml$/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

export async function pptxBufferToMarkdown(buf: Buffer, fileName: string): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buf);

    // Collect slide + notes files in deck order.
    const slidePaths: string[] = [];
    const notesByPath: Map<string, string> = new Map();
    zip.forEach((p) => {
      if (/^ppt\/slides\/slide\d+\.xml$/.test(p)) slidePaths.push(p);
      else if (/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p)) notesByPath.set(p, p);
    });
    slidePaths.sort((a, b) => slideNumberOf(a) - slideNumberOf(b));

    if (slidePaths.length === 0) {
      return `<!-- [pptx-attachment] ${fileName} has no slides (ppt/slides/slide*.xml) — not a valid PPTX? -->\n`;
    }

    const sections: string[] = [];
    const slidesToRender = slidePaths.slice(0, MAX_SLIDES);
    for (const path of slidesToRender) {
      const n = slideNumberOf(path);
      const xml = await zip.file(path)!.async("string");
      const body = extractRunText(xml);
      const notesPath = `ppt/notesSlides/notesSlide${n}.xml`;
      const notesXml = notesByPath.has(notesPath) ? await zip.file(notesPath)!.async("string") : "";
      const notes = notesXml ? extractRunText(notesXml) : "";
      sections.push(
        `## Slide ${n}\n\n` +
          (body.length > 0 ? body : "_(no text on this slide)_") +
          (notes.length > 0 ? `\n\n_Speaker notes:_ ${notes}` : ""),
      );
    }

    let md = sections.join("\n\n---\n\n");
    if (slidePaths.length > MAX_SLIDES) {
      md += `\n\n<!-- [pptx-attachment] ${fileName} has ${slidePaths.length} slides; truncated to first ${MAX_SLIDES} -->\n`;
    }
    if (md.length > MAX_OUTPUT_CHARS) {
      md =
        md.slice(0, MAX_OUTPUT_CHARS) +
        `\n\n<!-- [pptx-attachment] truncated at ${MAX_OUTPUT_CHARS.toLocaleString()} chars for ${fileName} -->\n`;
    }
    return md;
  } catch (err) {
    return `<!-- [pptx-attachment] failed to convert ${fileName}: ${err instanceof Error ? err.message : String(err)} -->\n`;
  }
}
