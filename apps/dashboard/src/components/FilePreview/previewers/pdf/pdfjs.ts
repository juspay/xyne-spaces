import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

/** The worker, copied beside the app by vite.config's static copy: the one chat's viewer uses. */
const WORKER_URL = '/pdfjs/pdf.worker.min.js';

/** Bytes per request: a page or two of a scan, a whole short document. */
const RANGE_CHUNK_BYTES = 1024 * 1024;

/**
 * Opens a PDF from its address, a piece at a time: the server answers byte ranges,
 * so a 200-page scan shows its first page without the rest being fetched first, and
 * the rest comes as it is scrolled to. The session's cookie goes with every request,
 * as it does for the video player.
 */
export function openPdf(url: string): PDFDocumentLoadingTask {
  pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
  return pdfjsLib.getDocument({
    url,
    withCredentials: true,
    rangeChunkSize: RANGE_CHUNK_BYTES,
    disableStream: true,
    disableAutoFetch: true,
    // Fonts drawn without compiling code the file carries.
    isEvalSupported: false,
  });
}

/**
 * A page's text as its text layer lays it out: each piece of text in order, and a line
 * break where the layer puts a <br>. Read with the options the viewer reads it with, so
 * a match counted here is the same match found on the drawn page.
 */
export async function pageText(document: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent({
    includeMarkedContent: true,
    disableNormalization: true,
  });
  let text = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text;
}
