import type { PartialBlock } from '@blocknote/core';
import DOMPurify from 'dompurify';
import { blobToBase64, createPreviewUrl } from '../services/clients/fileFetchService';

/**
 * Minimal shape of a BlockNote editor instance required to export a canvas.
 * Both CanvasEditor and CollaborativeCanvasEditor hold an editor that satisfies
 * this (the export methods are synchronous in @blocknote/core 0.51.x, but we
 * tolerate a Promise return as well for forward-compatibility).
 */
export interface CanvasExportEditor {
  document: PartialBlock[];
  blocksToMarkdownLossy: (blocks?: PartialBlock[]) => string | Promise<string>;
  blocksToHTMLLossy: (blocks?: PartialBlock[]) => string | Promise<string>;
}

export interface CanvasPdfExportResult {
  saved: boolean;
  filePath?: string;
}

export type CanvasMarkdownExportResult = CanvasPdfExportResult;

export type CanvasDocxExportResult = CanvasPdfExportResult;

// Custom canvas block types that have no text/markdown representation. The lossy
// serializers silently drop them. When the live editor DOM is available we
// rasterize the rendered block (whiteboard drawing / AI output) to a PNG and
// embed it as a native image block so it survives both Markdown and PDF export.
// When the DOM is not available (or capture fails) we fall back to a readable
// placeholder paragraph instead of leaving a hole in the exported file.
const CUSTOM_BLOCK_PLACEHOLDERS: Record<string, string> = {
  whiteboard: '[Whiteboard — open the canvas to view]',
  spreadsheet: '[Spreadsheet — open the canvas to view]',
};

type LooseInline = { type?: string; props?: Record<string, unknown> };
type LooseBlock = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: LooseBlock[];
};

const makeParagraph = (text: string): LooseBlock => ({
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
});

// A native BlockNote image block — serializes to `![](url)` in Markdown and
// `<img src="url">` in HTML, so a captured whiteboard/genius drawing renders in
// both export formats.
const makeImageBlock = (url: string, name: string): LooseBlock => ({
  type: 'image',
  props: { url, caption: '', showPreview: true, name },
  children: [],
});

// Safely read a string prop from loose BlockNote block props. Empty strings are
// treated as missing so we do not try to export blank image URLs.
const getStringProp = (props: Record<string, unknown> | undefined, key: string): string | null => {
  const value = props?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
};

// Image blocks can store their source under different prop names depending on
// how they were created, so check the known candidates in priority order.
const getImageSource = (props: Record<string, unknown> | undefined): string | null =>
  getStringProp(props, 'url') ||
  getStringProp(props, 'src') ||
  getStringProp(props, 'fileUrl') ||
  getStringProp(props, 'attachmentId') ||
  getStringProp(props, 'id');

// Convert an app attachment/image source into a data URI that survives in the
// detached print window. Existing data URIs are already self-contained.
async function resolveImageSourceForExport(source: string): Promise<string | null> {
  if (source.startsWith('data:')) return source;

  try {
    const blob = await createPreviewUrl(source);
    const base64 = await blobToBase64(blob);
    const mimeType = blob.type || 'image/png';
    return base64 ? `data:${mimeType};base64,${base64}` : null;
  } catch {
    return null;
  }
}

/**
 * Escape a value for safe use inside a CSS attribute selector. Prefers the
 * native `CSS.escape`; falls back to escaping the characters that are special
 * inside an attribute-selector string for environments without it.
 */
function escapeSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\\][]/g, '\\$&');
}

/**
 * Rasterize a rendered DOM node to a PNG data URL via html2canvas (a dashboard
 * dependency, dynamically imported so it never bloats the main bundle). Returns
 * null on any failure so the caller can fall back to a text placeholder.
 */
async function captureNodeAsImage(node: Element | null): Promise<string | null> {
  if (!node || !(node instanceof HTMLElement)) return null;
  try {
    const mod = await import('html2canvas');
    const html2canvas = (mod as { default: typeof import('html2canvas').default }).default;
    const canvas = await html2canvas(node, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    });
    const dataUrl = canvas.toDataURL('image/png');
    // A near-empty capture (e.g. html2canvas could not paint an SVG/canvas) is
    // worse than the placeholder, so treat tiny payloads as a failure.
    return dataUrl && dataUrl.length > 256 ? dataUrl : null;
  } catch {
    return null;
  }
}

/**
 * Deep-clone the document and rewrite the constructs the lossy serializers would
 * otherwise drop:
 *  - inline `mention` content -> plain "@name" text
 *  - whiteboard / genius / spreadsheet blocks -> a captured image of the live
 *    rendered block (when `domRoot` is supplied), else a placeholder paragraph
 * The clone protects the live editor state from mutation.
 */
async function normalizeBlocksForExport(
  blocks: PartialBlock[],
  domRoot?: HTMLElement | null,
): Promise<PartialBlock[]> {
  const cloned = structuredClone(blocks) as unknown as LooseBlock[];

  const walk = async (arr: LooseBlock[]): Promise<LooseBlock[]> =>
    Promise.all(
      arr.map(async block => {
        const placeholder = block?.type ? CUSTOM_BLOCK_PLACEHOLDERS[block.type] : undefined;
        if (placeholder) {
          // Try to preserve the visual block as a captured image first.
          const node =
            domRoot && block.id
              ? domRoot.querySelector(`[data-id="${escapeSelector(block.id)}"]`)
              : null;
          const captured = await captureNodeAsImage(node);
          if (captured) {
            return makeImageBlock(
              captured,
              (block.props?.['title'] as string) || block.type || 'image',
            );
          }
          return makeParagraph(placeholder);
        }

        if (block?.type === 'image') {
          const imageSource = getImageSource(block.props);
          if (imageSource) {
            const resolvedSource = await resolveImageSourceForExport(imageSource);
            if (resolvedSource) {
              block.props = {
                ...(block.props || {}),
                url: resolvedSource,
                showPreview: true,
              };
            }
          }
        }

        if (Array.isArray(block?.content)) {
          block.content = (block.content as LooseInline[]).map(inline => {
            if (inline?.type === 'mention') {
              const name =
                (inline.props?.['username'] as string) ||
                (inline.props?.['groupName'] as string) ||
                'mention';
              return { type: 'text', text: `@${name}`, styles: {} };
            }
            return inline;
          });
        }

        if (Array.isArray(block?.children) && block.children.length > 0) {
          block.children = await walk(block.children);
        }

        return block;
      }),
    );

  return (await walk(cloned)) as unknown as PartialBlock[];
}

/** Turn a canvas title into a safe download filename stem. */
export function sanitizeFilename(title: string): string {
  const base = (title || 'canvas')
    .trim()
    .replace(/[^\w\d-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'canvas';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function triggerDownload(filename: string, content: string | Blob, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Defer revoke so the download has time to start in all browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Export the canvas as a downloadable Markdown (.md) file.
 * `domRoot` is the live editor container; when supplied, whiteboard/genius
 * blocks are captured as embedded images instead of text placeholders.
 */
export async function exportCanvasAsMarkdown(
  editor: CanvasExportEditor,
  title: string,
  domRoot?: HTMLElement | null,
): Promise<CanvasMarkdownExportResult> {
  const blocks = await normalizeBlocksForExport(editor.document, domRoot);
  const body = await Promise.resolve(editor.blocksToMarkdownLossy(blocks));
  const heading = `# ${title || 'Untitled Canvas'}\n\n`;
  const filename = `${sanitizeFilename(title)}.md`;
  const content = heading + body;

  if (window.electronAPI?.exportCanvasMarkdown) {
    return window.electronAPI.exportCanvasMarkdown(filename, content);
  }

  triggerDownload(filename, content, 'text/markdown;charset=utf-8');
  return { saved: true };
}

// Readable, dependency-free print styles for the PDF export window.
const PRINT_CSS = `
  *{box-sizing:border-box;}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    color:#1a1a1a;line-height:1.6;max-width:820px;margin:0 auto;padding:48px 40px;}
  h1.canvas-export-title{font-size:28px;font-weight:700;margin:0 0 4px;}
  .canvas-export-meta{color:#888;font-size:12px;margin:0 0 28px;border-bottom:1px solid #eee;padding-bottom:16px;}
  h1,h2,h3,h4{font-weight:700;line-height:1.3;margin:24px 0 8px;}
  h1{font-size:24px;} h2{font-size:20px;} h3{font-size:17px;} h4{font-size:15px;}
  p{margin:8px 0;} ul,ol{margin:8px 0;padding-left:24px;}
  li{margin:4px 0;}
  a{color:#2563eb;text-decoration:underline;}
  code{font-family:'SFMono-Regular',Consolas,monospace;background:#f4f4f5;padding:1px 5px;border-radius:4px;font-size:0.9em;}
  pre{background:#f4f4f5;padding:14px 16px;border-radius:8px;overflow:auto;}
  pre code{background:none;padding:0;}
  blockquote{border-left:3px solid #d4d4d8;margin:12px 0;padding:4px 16px;color:#52525b;}
  img{max-width:100%;height:auto;border-radius:6px;}
  table{border-collapse:collapse;width:100%;margin:12px 0;}
  th,td{border:1px solid #d4d4d8;padding:8px 10px;text-align:left;}
  th{background:#f4f4f5;font-weight:600;}
  @media print{body{padding:0;}@page{margin:18mm;}}
`;

function buildPdfHtml(title: string, bodyHtml: string): string {
  const safeTitle = escapeHtml(title || 'Untitled Canvas');
  const dateStr = new Date().toLocaleString();

  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<title>${safeTitle}</title><style>${PRINT_CSS}</style></head><body>` +
    `<h1 class="canvas-export-title">${safeTitle}</h1>` +
    `<div class="canvas-export-meta">Exported from Xyne Canvas · ${escapeHtml(dateStr)}</div>` +
    `${bodyHtml}` +
    `</body></html>`
  );
}

/**
 * Export the canvas as a PDF from the same sanitized HTML used for print export.
 * Electron sends the HTML to the main process and renders it with Chromium's
 * printToPDF API; browsers fall back to opening a print window and calling print().
 * `domRoot` lets custom canvas blocks be captured as embedded images first.
 */
export async function exportCanvasAsPDF(
  editor: CanvasExportEditor,
  title: string,
  domRoot?: HTMLElement | null,
): Promise<CanvasPdfExportResult> {
  const blocks = await normalizeBlocksForExport(editor.document, domRoot);
  const rawBodyHtml = await Promise.resolve(editor.blocksToHTMLLossy(blocks));
  // The canvas body is user-controlled, so sanitize the serialized HTML before
  // it is written into the print document. Embedded export images use base64
  // data URIs, which must stay allowed for whiteboard/image blocks to render.
  const bodyHtml = DOMPurify.sanitize(rawBodyHtml, {
    USE_PROFILES: { html: true },
    ADD_DATA_URI_TAGS: ['img'],
  });
  const html = buildPdfHtml(title, bodyHtml);
  const filename = `${sanitizeFilename(title)}.pdf`;

  if (window.electronAPI?.exportCanvasPdf) {
    return window.electronAPI.exportCanvasPdf(filename, html);
  }

  const printWindow = window.open('', '_blank', 'width=900,height=1200');
  if (!printWindow) {
    throw new Error('Unable to open the print window — please allow pop-ups for this site.');
  }
  printWindow.document.write(
    html.replace(
      '</body></html>',
      `<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},350);};</script></body></html>`,
    ),
  );
  printWindow.document.close();
  return { saved: true };
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function exportCanvasAsDocx(
  editor: CanvasExportEditor,
  title: string,
  domRoot?: HTMLElement | null,
): Promise<CanvasDocxExportResult> {
  const blocks = await normalizeBlocksForExport(editor.document, domRoot);
  const rawBodyHtml = await Promise.resolve(editor.blocksToHTMLLossy(blocks));
  const bodyHtml = DOMPurify.sanitize(rawBodyHtml, {
    USE_PROFILES: { html: true },
    ADD_DATA_URI_TAGS: ['img'],
  });
  const { default: HTMLtoDOCX } = await import('@turbodocx/html-to-docx');
  const out = await HTMLtoDOCX(buildPdfHtml(title, bodyHtml), null, {
    title: title || 'Untitled Canvas',
    table: { row: { cantSplit: true } },
  });
  const blob = out instanceof Blob ? out : new Blob([out as ArrayBuffer], { type: DOCX_MIME });
  const filename = `${sanitizeFilename(title)}.docx`;

  if (window.electronAPI?.exportCanvasDocx) {
    return window.electronAPI.exportCanvasDocx(filename, await blob.arrayBuffer());
  }

  triggerDownload(filename, blob, DOCX_MIME);
  return { saved: true };
}
