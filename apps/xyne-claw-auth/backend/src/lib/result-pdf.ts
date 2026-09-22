/**
 * Render a long agent response into a PDF buffer.
 *
 * Why this exists: Spaces' `Message.content` enforces a 10,000-character cap
 * inside `messageRepository.create()` (see Spaces backend code). Posting a
 * longer result via `/chat/postMessage` returns a generic 500 and the user
 * sees nothing — root cause of multiple lost responses observed in prod logs.
 *
 * Strategy when over the cap: render the full markdown text into a plain
 * PDF, attach that to the message, and post a short stub as the chat body
 * with a preview of the first few hundred characters. The user gets the full
 * answer (downloaded), and the conversation thread stays usable.
 *
 * `pdfkit` chosen over `md-to-pdf` / puppeteer to avoid shipping a Chromium
 * dependency in the claw-auth pod. PDF fidelity is plain monospaced text —
 * acceptable for a "too long for chat" fallback. Code blocks render
 * legibly; tables/diagrams do not, by design.
 */

import PDFDocument from "pdfkit";
import { errMsg } from "./errors.js";
import { marked, type Tokens, type Token } from "marked";

export interface PdfRenderOptions {
  /** Title shown on the first page header. Defaults to "Agent Response". */
  title?: string;
  /** Subtitle below the title, e.g. agent slug + timestamp. Omitted when blank. */
  subtitle?: string;
}

// ── Markdown → PDF rendering ──────────────────────────────────────────────
//
// Strategy: parse markdown with `marked`'s lexer, walk the block-level tokens,
// dispatch to pdfkit per block type. Inline runs (`**bold**`, `*italic*`,
// `code`, [links]) are flattened into a sequence of styled segments and
// emitted with pdfkit's `continued: true` chaining so a single paragraph can
// mix fonts.
//
// Why this instead of md-to-pdf / puppeteer: we don't want a Chromium dep in
// the claw-auth pod (image size, cold-start latency). pdfkit's 14 standard
// PDF fonts cover bold/italic/monospaced Latin out of the box with zero
// runtime cost; the only thing they don't cover is emoji glyphs — those are
// stripped before rendering so the output stays clean instead of producing
// the `Ø=ÜÊ` mojibake the default fonts emit for non-BMP codepoints.

/** Strip characters outside the BMP-Latin range that pdfkit's standard fonts
 *  can't render (emoji + most symbol blocks). Without this, those bytes get
 *  shown as garbled Latin-1 placeholders. Trade-off: the PDF loses the
 *  emoji but the rest of the text stays legible. Swap-in: bundle a Noto or
 *  DejaVu font with emoji coverage in a future iteration. */
function stripUnrenderable(s: string): string {
  return s
    // Emoji & symbol blocks — outside BMP
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    // Misc symbols + dingbats + arrows (some commonly used emoji-like chars)
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    // Misc symbols & pictographs supplement
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, "")
    // Variation selectors (e.g. text/emoji presentation modifiers)
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "");
}

interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
}

/** Recursively flatten inline tokens (text/strong/em/codespan/link/br/del)
 *  into a sequence of styled runs. Nested styles (e.g. `**[link](url)**`)
 *  propagate via the `inherit` accumulator. */
function flattenInline(tokens: Token[] | undefined, inherit: Omit<InlineRun, "text"> = {}): InlineRun[] {
  if (!tokens) return [];
  const out: InlineRun[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "text": {
        const tt = t as Tokens.Text;
        // Tokens.Text can have nested tokens (e.g. text containing inline
        // formatting from inside a list item); prefer those when present.
        if (tt.tokens && tt.tokens.length > 0) {
          out.push(...flattenInline(tt.tokens, inherit));
        } else {
          out.push({ ...inherit, text: stripUnrenderable(tt.text) });
        }
        break;
      }
      case "paragraph":
        // Inside a list item (or any nested context), a `paragraph` token
        // wraps inline content. Recurse so the inline tokens get styled,
        // same as if we were called with the paragraph's `tokens` directly.
        out.push(...flattenInline((t as Tokens.Paragraph).tokens, inherit));
        break;
      case "strong":
        out.push(...flattenInline((t as Tokens.Strong).tokens, { ...inherit, bold: true }));
        break;
      case "em":
        out.push(...flattenInline((t as Tokens.Em).tokens, { ...inherit, italic: true }));
        break;
      case "codespan":
        out.push({ ...inherit, code: true, text: (t as Tokens.Codespan).text });
        break;
      case "link":
        out.push(...flattenInline((t as Tokens.Link).tokens, { ...inherit, link: (t as Tokens.Link).href }));
        break;
      case "br":
        out.push({ ...inherit, text: "\n" });
        break;
      case "del":
        // pdfkit has no native strikethrough; render as plain
        out.push(...flattenInline((t as Tokens.Del).tokens, inherit));
        break;
      default: {
        // Unknown inline node — emit raw text if present
        const anyT = t as { text?: string };
        if (typeof anyT.text === "string") {
          out.push({ ...inherit, text: stripUnrenderable(anyT.text) });
        }
      }
    }
  }
  return out;
}

/** Emit a sequence of styled runs onto pdfkit using `continued: true`
 *  chaining so font/style switches happen mid-line. The final run drops
 *  `continued`, which is what flushes the line. */
function renderInlineRuns(
  doc: PDFKit.PDFDocument,
  runs: InlineRun[],
  options: { baseFont?: string; size?: number } = {},
): void {
  const baseFont = options.baseFont ?? "Helvetica";
  const size = options.size ?? 11;
  if (runs.length === 0) {
    doc.text(""); // emit an empty line so callers can rely on doc.y advancing
    return;
  }
  doc.fontSize(size);
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]!;
    const isLast = i === runs.length - 1;
    // Pick font based on style flags.
    if (r.code) {
      doc.font("Courier");
    } else if (r.bold && r.italic) {
      doc.font(`${baseFont}-BoldOblique`);
    } else if (r.bold) {
      doc.font(`${baseFont}-Bold`);
    } else if (r.italic) {
      doc.font(`${baseFont}-Oblique`);
    } else {
      doc.font(baseFont);
    }
    if (r.link) {
      doc.fillColor("#0066cc");
    } else {
      doc.fillColor("black");
    }
    // pdfkit's text() with `link` option adds a clickable annotation.
    const textOpts: PDFKit.Mixins.TextOptions = { continued: !isLast };
    if (r.link) textOpts.link = r.link;
    doc.text(r.text, textOpts);
  }
  // Reset to defaults so the next block doesn't inherit mid-paragraph styles.
  doc.fillColor("black").font(baseFont).fontSize(size);
}

/** Block-level dispatch. Recursive — blockquote contents and list items
 *  contain their own block tokens. */
function renderBlocks(doc: PDFKit.PDFDocument, tokens: Token[]): void {
  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading;
        const sizes = [22, 18, 15, 13, 11.5, 11];
        const size = sizes[Math.min(h.depth, sizes.length) - 1] ?? 11;
        doc.moveDown(0.5);
        renderInlineRuns(doc, [{ text: "", bold: true }, ...flattenInline(h.tokens, { bold: true })], { size });
        doc.moveDown(0.2);
        break;
      }
      case "paragraph": {
        const p = t as Tokens.Paragraph;
        renderInlineRuns(doc, flattenInline(p.tokens), { size: 11 });
        doc.moveDown(0.4);
        break;
      }
      case "code": {
        const c = t as Tokens.Code;
        const left = doc.page.margins.left;
        const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        doc.fontSize(9.5).font("Courier");
        const lineHeight = doc.currentLineHeight();
        const lines = c.text.split("\n");
        const blockHeight = lines.length * lineHeight + 8;
        const startY = doc.y;
        // Light gray background. Drawn first so the text overlays it.
        doc.rect(left, startY, width, blockHeight).fillColor("#f3f4f6").fill();
        doc.fillColor("#1f2937"); // dark slate text inside the block
        doc.y = startY + 4;
        for (const line of lines) {
          doc.text(line, left + 6, doc.y, { lineBreak: false });
          doc.moveDown(0);
        }
        doc.fillColor("black").font("Helvetica").fontSize(11);
        doc.y = startY + blockHeight + 4;
        doc.moveDown(0.2);
        break;
      }
      case "list": {
        const l = t as Tokens.List;
        let i = 1;
        for (const item of l.items) {
          const prefix = l.ordered ? `${i}. ` : "•  ";
          // Items contain a mix of inline content (the line body) and block
          // content (nested list / code block / etc.). Split them:
          //   - tight list   → item.tokens[0] is a `text` token whose `.tokens`
          //                    array holds the parsed inline runs.
          //   - loose list   → item.tokens[0] is a `paragraph` with the same.
          // flattenInline handles BOTH because we added `paragraph` + the
          // `text` case already recurses into nested `.tokens`. Block-typed
          // children (sub-lists, code) are rendered recursively after, with
          // an extra indent so nesting visibly cascades.
          const inlineTokens: Token[] = [];
          const blockTokens: Token[] = [];
          for (const sub of item.tokens) {
            if (sub.type === "paragraph" || sub.type === "text") {
              inlineTokens.push(sub);
            } else {
              blockTokens.push(sub);
            }
          }
          const inline: InlineRun[] = [{ text: prefix }, ...flattenInline(inlineTokens)];
          renderInlineRuns(doc, inline, { size: 11 });
          if (blockTokens.length > 0) {
            const savedX = doc.x;
            doc.x = savedX + 18;
            renderBlocks(doc, blockTokens);
            doc.x = savedX;
          }
          i++;
        }
        doc.moveDown(0.3);
        break;
      }
      case "blockquote": {
        const bq = t as Tokens.Blockquote;
        const savedX = doc.x;
        doc.x = savedX + 14;
        doc.fillColor("#555");
        renderBlocks(doc, bq.tokens || []);
        doc.fillColor("black");
        doc.x = savedX;
        break;
      }
      case "hr": {
        doc.moveDown(0.4);
        const y = doc.y;
        doc.moveTo(doc.page.margins.left, y)
          .lineTo(doc.page.width - doc.page.margins.right, y)
          .lineWidth(0.5)
          .strokeColor("#d0d0d0")
          .stroke();
        doc.moveDown(0.5);
        break;
      }
      case "space":
        doc.moveDown(0.2);
        break;
      case "html": {
        const h = t as Tokens.HTML;
        // Treat HTML as raw text (already-stripped of emoji). Tables that
        // marked emits as html (without enabling `gfm`) end up here.
        doc.fontSize(11).font("Helvetica").text(stripUnrenderable(h.text));
        doc.moveDown(0.3);
        break;
      }
      case "table": {
        const tab = t as Tokens.Table;
        // Real column-aligned table. Equal-width columns across the printable
        // area, word-wrap inside each cell, bold header with a divider line
        // below, hairline divider between data rows. Inline formatting
        // (**bold**, *italic*, `code`, [link]) is preserved per-cell via the
        // same flattenInline + continued-chaining trick used elsewhere.
        const cols = tab.header.length;
        if (cols === 0) {
          doc.moveDown(0.3);
          break;
        }
        const left = doc.page.margins.left;
        const right = doc.page.width - doc.page.margins.right;
        const totalWidth = right - left;
        const colWidth = totalWidth / cols;
        const cellPad = 4;
        const innerWidth = colWidth - cellPad * 2;

        /** Render a single cell at (x, y), bounded by `innerWidth`. Returns
         *  the y-coordinate just below the last line of text — used to find
         *  the tallest cell in the row so the next row's top aligns. */
        const renderCell = (
          cell: Tokens.TableCell | undefined,
          x: number,
          y: number,
          baseBold: boolean,
        ): number => {
          const inheritBold = baseBold ? { bold: true } : {};
          const runs = cell
            ? flattenInline(cell.tokens, inheritBold)
            : [];
          if (runs.length === 0) {
            // Empty cell — emit a space so the cell still occupies a line of
            // vertical space, otherwise its column's y-cursor wouldn't
            // advance and the row would collapse.
            doc.font(baseBold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
            doc.text(" ", x + cellPad, y + cellPad, { width: innerWidth });
            return doc.y;
          }
          doc.fontSize(10);
          for (let i = 0; i < runs.length; i++) {
            const r = runs[i]!;
            const isLast = i === runs.length - 1;
            if (r.code) {
              doc.font("Courier");
            } else if (r.bold && r.italic) {
              doc.font("Helvetica-BoldOblique");
            } else if (r.bold) {
              doc.font("Helvetica-Bold");
            } else if (r.italic) {
              doc.font("Helvetica-Oblique");
            } else {
              doc.font("Helvetica");
            }
            doc.fillColor(r.link ? "#0066cc" : "black");
            const opts: PDFKit.Mixins.TextOptions = { continued: !isLast };
            if (r.link) opts.link = r.link;
            if (i === 0) {
              // First run sets the (x, y, width) bounding box for the cell.
              // Subsequent continued: true runs flow inside that box.
              doc.text(r.text, x + cellPad, y + cellPad, { ...opts, width: innerWidth });
            } else {
              doc.text(r.text, opts);
            }
          }
          return doc.y;
        };

        const flattenCellPlainText = (cell: Tokens.TableCell | undefined): string => {
          if (!cell) return " ";
          const runs = flattenInline(cell.tokens, {});
          const joined = runs.map((r) => r.text).join("");
          return joined.length > 0 ? joined : " ";
        };

        const drawRow = (cells: Tokens.TableCell[], isHeader: boolean): void => {
          // Pre-measure the row's tallest cell so we can decide whether to
          // page-break BEFORE drawing. Without this, pdfkit auto-paginates
          // inside doc.text() when y is near the page bottom — but it only
          // re-pages for the cell that triggered the overflow, while the next
          // cell in the row still receives the original (now off-page)
          // startY. Net effect: each cell ends up on its own page.
          //
          // Measure with Helvetica-Bold (wider than Helvetica/Courier at 10pt
          // for typical text) so inline **bold** / `code` runs in data cells
          // don't push the actual render past the measurement and re-trigger
          // the cascade.
          doc.font("Helvetica-Bold").fontSize(10);
          let rowHeight = 0;
          for (let c = 0; c < cols; c++) {
            const h = doc.heightOfString(flattenCellPlainText(cells[c]), { width: innerWidth });
            if (h > rowHeight) rowHeight = h;
          }
          // One-line buffer absorbs residual drift from mixed-font wrapping
          // inside a single cell (Helvetica + BoldOblique + Courier).
          const oneLine = doc.heightOfString("M", { width: innerWidth });
          rowHeight += cellPad * 2 + oneLine;

          const pageBottom = doc.page.height - doc.page.margins.bottom;
          if (doc.y + rowHeight > pageBottom) {
            doc.addPage();
          }

          // Defensive: even with pre-measurement, a single cell taller than
          // a printable page can still trigger pdfkit's internal auto-pager
          // inside renderCell. If that happens, rebase startY to the top of
          // the new page for subsequent cells so each cell lands in its own
          // column instead of cascading to its own page.
          let startY = doc.y;
          let pageRef = doc.page;
          let maxYOnCurrentPage = startY;
          for (let c = 0; c < cols; c++) {
            if (doc.page !== pageRef) {
              pageRef = doc.page;
              startY = doc.page.margins.top;
              maxYOnCurrentPage = startY;
            }
            const cellY = renderCell(cells[c], left + c * colWidth, startY, isHeader);
            if (doc.page !== pageRef) {
              // Cell spilled mid-render. Track the new page; subsequent cells
              // restart at its top via the check at the start of next iter.
              pageRef = doc.page;
              maxYOnCurrentPage = doc.y;
            } else if (cellY > maxYOnCurrentPage) {
              maxYOnCurrentPage = cellY;
            }
          }
          // Advance past the tallest cell on the final page + a little padding.
          doc.y = maxYOnCurrentPage + cellPad;
          doc.x = left; // reset so the next pdfkit text() call lands at left margin
        };

        drawRow(tab.header, true);
        // Stronger divider under the header.
        doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.6).strokeColor("#888").stroke();
        doc.moveDown(0.1);

        for (const row of tab.rows) {
          drawRow(row, false);
          // Hairline between data rows so eyes can track across.
          doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.3).strokeColor("#e5e7eb").stroke();
          doc.moveDown(0.1);
        }

        doc.fillColor("black").font("Helvetica").fontSize(11);
        doc.moveDown(0.3);
        break;
      }
      default: {
        // Unknown / unsupported block — fall back to its raw text if any.
        const anyT = t as { raw?: string; text?: string };
        const raw = typeof anyT.raw === "string" ? anyT.raw : anyT.text;
        if (typeof raw === "string" && raw.trim()) {
          doc.fontSize(11).font("Helvetica").text(stripUnrenderable(raw));
          doc.moveDown(0.3);
        }
      }
    }
  }
}

/**
 * Render markdown to a PDF buffer suitable for uploading via Spaces'
 * multipart attachment endpoint. Headings get proper sizes, **bold** and
 * *italic* render inline, lists get bullets/numbers, code blocks get a
 * gray-tinted monospaced box, and links become clickable annotations.
 * Tables fall back to monospaced text rows.
 *
 * Emojis are stripped (see `stripUnrenderable`) — pdfkit's standard fonts
 * have no glyph coverage for them and produce mojibake otherwise.
 */
export function renderMarkdownToPdf(markdown: string, opts: PdfRenderOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        info: {
          Title: opts.title ?? "Agent Response",
          Producer: "xyne-claw-auth",
          CreationDate: new Date(),
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Header
      doc.fontSize(18).font("Helvetica-Bold").text(opts.title ?? "Agent Response", { align: "left" });
      if (opts.subtitle) {
        doc.moveDown(0.2);
        doc.fontSize(9).font("Helvetica").fillColor("#666").text(opts.subtitle);
        doc.fillColor("black");
      }
      doc.moveDown(0.8);

      // Parse → walk → emit. `marked.lexer` returns the array of block tokens
      // directly. We don't pass `gfm: true` because we render tables manually
      // anyway, and disabling gfm keeps the lexer's table output as `html` so
      // our renderer is consistent across marked versions.
      const tokens = marked.lexer(stripUnrenderable(markdown));
      renderBlocks(doc, tokens);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * @deprecated Kept for backward-compatibility. Prefer `renderMarkdownToPdf`.
 * Existing callers that pass plain (non-markdown) text will get sensible
 * output here since marked's lexer treats the whole thing as a paragraph.
 */
export function renderTextToPdf(text: string, opts: PdfRenderOptions = {}): Promise<Buffer> {
  return renderMarkdownToPdf(text, opts);
}

/**
 * Input shape for `renderAttachmentsToPdf` — matches the OutgoingAttachment
 * type webhook.ts already handles, kept inline to avoid a circular import.
 */
export interface PdfAttachmentInput {
  data: string;          // base64
  mimeType: string;
  fileName: string;
}

/**
 * Bundle many attachments into a single PDF. Used when an agent emits more
 * attachments than Spaces' per-message multipart cap allows (currently 10
 * files per request via multer's `files: 10` limit) — rather than dropping
 * the excess, we collapse them into one PDF with one attachment per page:
 *
 *   - Images (image/png, jpeg, gif, webp) — embedded full-page via `doc.image`.
 *     This is the dominant case (sandbox/playwright screenshot runs).
 *   - Text-like (text/*, application/json, application/yaml, application/xml)
 *     — decoded from base64, rendered as monospaced text.
 *   - Anything else (binary blobs, zip, pdf-within-pdf, etc.) — a stub page
 *     with the filename + a note that the binary couldn't be inlined.
 *
 * The first page is a cover with the attachment list so users get a
 * table-of-contents view before scrolling.
 */
export function renderAttachmentsToPdf(
  attachments: PdfAttachmentInput[],
  opts: PdfRenderOptions = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 36,
        info: {
          Title: opts.title ?? "Bundled Attachments",
          Producer: "xyne-claw-auth",
          CreationDate: new Date(),
        },
        autoFirstPage: false,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Cover page — title, subtitle, table-of-contents.
      doc.addPage();
      doc.fontSize(18).font("Helvetica-Bold").text(opts.title ?? "Bundled Attachments");
      if (opts.subtitle) {
        doc.moveDown(0.2);
        doc.fontSize(9).font("Helvetica").fillColor("#666").text(opts.subtitle);
        doc.fillColor("black");
      }
      doc.moveDown(0.5);
      doc.fontSize(10).font("Helvetica-Bold").text(`Contents (${attachments.length})`);
      doc.moveDown(0.2);
      doc.fontSize(9).font("Helvetica");
      attachments.forEach((att, i) => {
        doc.text(`${i + 1}.  ${att.fileName}  —  ${att.mimeType}`, { indent: 10 });
      });

      // One page per attachment.
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const pageHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;

      attachments.forEach((att, i) => {
        doc.addPage();
        // Per-page header: index + filename + mime
        doc.fontSize(10).font("Helvetica-Bold").text(`${i + 1}. ${att.fileName}`);
        doc.fontSize(8).font("Helvetica").fillColor("#666").text(att.mimeType);
        doc.fillColor("black");
        doc.moveDown(0.5);

        const mime = att.mimeType.toLowerCase();
        const buffer = Buffer.from(att.data, "base64");

        if (mime.startsWith("image/")) {
          try {
            // Reserve space below the header — fit within remaining page area.
            const headerSpace = 50;
            doc.image(buffer, doc.page.margins.left, doc.y, {
              fit: [pageWidth, pageHeight - headerSpace],
              align: "center",
            });
          } catch (err) {
            doc.fontSize(9).font("Helvetica").fillColor("#a00").text(
              `[Could not render image: ${errMsg(err)}]`,
            );
            doc.fillColor("black");
          }
        } else if (
          mime.startsWith("text/") ||
          mime === "application/json" ||
          mime === "application/yaml" ||
          mime === "text/yaml" ||
          mime === "application/xml" ||
          mime === "text/xml"
        ) {
          // Decode + render as text. Cap at ~50K chars per attachment so a
          // single huge log file doesn't bloat the bundle into hundreds of
          // pages.
          let text = buffer.toString("utf8");
          let truncated = false;
          if (text.length > 50_000) {
            text = text.slice(0, 50_000);
            truncated = true;
          }
          doc.fontSize(9).font("Courier").text(text, { lineGap: 1.2 });
          if (truncated) {
            doc.moveDown(0.5);
            doc.fontSize(8).fillColor("#a00").text(`[Truncated at 50,000 chars — original ${buffer.length} bytes]`);
            doc.fillColor("black");
          }
        } else {
          // Unknown binary — list metadata, no inline render.
          doc.fontSize(10).font("Helvetica").fillColor("#666").text(
            `Binary attachment (${buffer.length.toLocaleString()} bytes). ` +
            `Cannot be rendered inline; the original file is referenced in the agent's response.`,
          );
          doc.fillColor("black");
        }
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
