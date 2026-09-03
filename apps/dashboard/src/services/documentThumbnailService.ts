import { logger, Event as LogEvent } from '../utils/logger';
/**
 * Document Thumbnail Generation Service
 *
 * Generates JPEG thumbnail previews for PDF, DOCX, XLSX, and CSV files
 * using browser-native APIs and existing frontend libraries (no LibreOffice).
 *
 * Follows the same pattern as thumbnailService.ts (video thumbnails).
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 400;
const THUMBNAIL_QUALITY = 0.88;

// ─── MIME-type helpers ───────────────────────────────────────────────────────

export function isPdfFile(mimeType: string): boolean {
  return mimeType === 'application/pdf';
}

export function isDocxFile(mimeType: string): boolean {
  return (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  );
}

export function isExcelFile(mimeType: string): boolean {
  return (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel'
  );
}

export function isCsvFile(mimeType: string): boolean {
  return mimeType === 'text/csv' || mimeType === 'text/comma-separated-values';
}

export function isPreviewableDocument(mimeType: string): boolean {
  return (
    isPdfFile(mimeType) || isDocxFile(mimeType) || isExcelFile(mimeType) || isCsvFile(mimeType)
  );
}

// ─── Canvas helpers ──────────────────────────────────────────────────────────

function createCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context');
  return { canvas, ctx };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) resolve(blob);
        else reject(new Error('canvas.toBlob returned null'));
      },
      'image/jpeg',
      THUMBNAIL_QUALITY,
    );
  });
}

/** Truncate text so it fits within maxWidth pixels. */
function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '…';
}

// ─── Table-based preview (Excel / CSV) ───────────────────────────────────────

function renderTablePreview(
  rows: (string | number | boolean | null | undefined)[][],
): Promise<Blob> {
  const { canvas, ctx } = createCanvas();

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  if (rows.length === 0) return canvasToBlob(canvas);

  const tableTop = 8;
  const rowHeight = 26;
  const colCount = Math.min(rows[0]?.length ?? 0, 8);
  if (colCount === 0) return canvasToBlob(canvas);

  const tableWidth = CANVAS_WIDTH - 16;
  const colWidth = Math.floor(tableWidth / colCount);
  const maxRows = Math.floor((CANVAS_HEIGHT - tableTop - 8) / rowHeight);

  for (let r = 0; r < Math.min(rows.length, maxRows); r++) {
    const row = rows[r] ?? [];
    const y = tableTop + r * rowHeight;
    const isHeader = r === 0;

    // Row background
    if (isHeader) {
      ctx.fillStyle = '#e3eeeb';
    } else {
      ctx.fillStyle = r % 2 === 0 ? '#ffffff' : '#f7f7f7';
    }
    ctx.fillRect(8, y, tableWidth, rowHeight);

    // Row border
    ctx.strokeStyle = '#dde3e0';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(8, y, tableWidth, rowHeight);

    for (let c = 0; c < colCount; c++) {
      const cellValue = String(row[c] ?? '');
      const x = 8 + c * colWidth;
      const maxCellWidth = colWidth - 10;

      ctx.font = isHeader
        ? 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        : '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = isHeader ? '#1a5c40' : '#333333';
      ctx.fillText(truncateText(ctx, cellValue, maxCellWidth), x + 5, y + 17);

      // Vertical cell separator
      if (c > 0) {
        ctx.strokeStyle = '#dde3e0';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + rowHeight);
        ctx.stroke();
      }
    }
  }

  return canvasToBlob(canvas);
}

// ─── Per-type generators ─────────────────────────────────────────────────────

async function generatePdfThumbnail(file: File): Promise<Blob> {
  // Dynamically import pdfjs from react-pdf (avoids loading it unless needed)
  const { pdfjs } = await import('react-pdf');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js';

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);

  // Scale first page to fit CANVAS_WIDTH, cap at 2×
  const unscaledViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(CANVAS_WIDTH / unscaledViewport.width, 2);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(Math.min(viewport.width, CANVAS_WIDTH));
  canvas.height = Math.round(Math.min(viewport.height, CANVAS_HEIGHT));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context');

  // pdfjs-dist v4+ requires `canvas` in RenderParameters
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  void pdf.destroy();

  return canvasToBlob(canvas);
}

async function generateDocxThumbnail(file: File): Promise<Blob> {
  const [{ renderAsync }, html2canvas] = await Promise.all([
    import('docx-preview'),
    import('html2canvas').then(m => m.default),
  ]);

  const arrayBuffer = await file.arrayBuffer();

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.style.width = '900px';
  container.style.background = '#fff';
  container.style.zIndex = '-1';
  document.body.appendChild(container);

  try {
    await renderAsync(arrayBuffer, container, undefined, {
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      className: 'docx-preview',
    });

    // Strip the page-wrapper styling so the thumbnail shows clean white content
    // instead of a "page floating on gray background" look
    const wrapperEl = container.firstElementChild as HTMLElement | null;
    if (wrapperEl) {
      wrapperEl.style.background = '#ffffff';
      wrapperEl.style.padding = '0';
      wrapperEl.style.overflow = 'visible';
    }
    container.querySelectorAll('section').forEach(el => {
      el.style.boxShadow = 'none';
      el.style.margin = '0';
      el.style.padding = '24px';
      el.style.width = '100%';
      el.style.minHeight = 'auto';
    });

    const canvas = await html2canvas(container, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
      width: Math.min(container.scrollWidth, 900),
      height: Math.min(container.scrollHeight, 1200),
      windowWidth: 1000,
      windowHeight: 1400,
    });

    const { canvas: outCanvas, ctx } = createCanvas();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const srcW = canvas.width;
    const srcH = canvas.height;
    const dstW = CANVAS_WIDTH;
    const dstH = CANVAS_HEIGHT;

    const srcAspect = srcW / srcH;
    const dstAspect = dstW / dstH;

    let cropW = srcW;
    let cropH = srcH;
    let cropX = 0;
    const cropY = 0;

    if (srcAspect > dstAspect) {
      cropW = Math.round(srcH * dstAspect);
      cropX = Math.round((srcW - cropW) / 2);
    } else {
      cropH = Math.round(srcW / dstAspect);
    }

    ctx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, dstW, dstH);

    return canvasToBlob(outCanvas);
  } finally {
    document.body.removeChild(container);
  }
}

async function generateExcelThumbnail(file: File): Promise<Blob> {
  const XLSX = await import('xlsx');

  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Excel file has no sheets');

  const sheet = workbook.Sheets[sheetName]!;
  const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  return renderTablePreview(rows.slice(0, 20));
}

async function generateCsvThumbnail(file: File): Promise<Blob> {
  const Papa = (await import('papaparse')).default;

  const text = await file.text();
  const result = Papa.parse<(string | number | boolean | null)[]>(text, {
    header: false,
    preview: 20,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  return renderTablePreview(result.data);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a JPEG thumbnail blob for a document file.
 * Returns null if the file type is not supported or generation fails.
 */
export async function generateDocumentThumbnail(file: File): Promise<Blob | null> {
  try {
    if (isPdfFile(file.type)) return await generatePdfThumbnail(file);
    if (isDocxFile(file.type)) return await generateDocxThumbnail(file);
    if (isExcelFile(file.type)) return await generateExcelThumbnail(file);
    if (isCsvFile(file.type)) return await generateCsvThumbnail(file);
    return null;
  } catch (error) {
    logger.warn(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_warn',
      message: String(
        `[documentThumbnailService] Failed to generate thumbnail for "${file.name}":`,
      ),
      context: [error],
    });
    return null;
  }
}
