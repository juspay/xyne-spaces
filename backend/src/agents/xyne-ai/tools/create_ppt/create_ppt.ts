/**
 * Create PPT Tool — LLM-driven JSON generation + PptxGenJS renderer
 *
 * The agent provides a query (presentation brief) and number of slides.
 * This tool makes an internal LLM call via the LiteLLM proxy to generate
 * the complete PptxGenJS slide JSON, renders it, uploads to GCS, and
 * returns only the download URL.
 */

import { z } from 'zod';
import https from 'node:https';
import { type Tool } from '@juspay-jaf/jaf';
import { AttachmentEntityType } from '@prisma/client';
import { logger } from '../../../../utils/logger.js';
import type { XyneAIAgentContext } from '../types.js';
import { getDescription } from '../helpers.js';
import { getStorageService } from '../../../../services/storage/index.js';
import { MessageAttachmentRepository } from '../../../../database/repositories/messageAttachmentRepository.js';
import { config } from '../../../../config/env.js';
import { PPTX_DESIGNER_SYSTEM_PROMPT } from './prompt.js';

const storageService = getStorageService();

// ─── HTTP helper ─────────────────────────────────────────────────────────────

/** POST JSON using native https — bypasses undici/fetch HTTP/2 GOAWAY issues. */
function httpsPost(
  url: string,
  body: string,
  headers: Record<string, string>
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Sanitizers ──────────────────────────────────────────────────────────────

/** Recursively strip '#' from any hex color strings. */
function stripHashes(val: any): any {
  if (typeof val === 'string') return /^#[0-9A-Fa-f]{3,8}$/.test(val) ? val.slice(1) : val;
  if (Array.isArray(val)) return val.map(stripHashes);
  if (val && typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) out[k] = stripHashes(v);
    return out;
  }
  return val;
}

/**
 * Sanitize options object before passing to PptxGenJS:
 * - Strip '#' from colors
 * - Fix fill/line shorthands ("2C2C2C" → { color: "2C2C2C" })
 * - Move root-level transparency into fill (only valid there)
 * - Remove transparency from text options (not supported)
 * - Remap font→fontFace, size→fontSize aliases
 * - Coerce string booleans and string numbers
 */
function sanitizeOptions(options: any, elementType: string): any {
  if (!options || typeof options !== 'object') return {};

  let opts = stripHashes({ ...options });

  // fill/line shorthand: "fill": "RRGGBB" → "fill": { "color": "RRGGBB" }
  if (typeof opts.fill === 'string') opts.fill = { color: opts.fill };
  if (typeof opts.line === 'string') opts.line = { color: opts.line };

  // transparency belongs inside fill/line, not at root
  if ('transparency' in opts) {
    if (elementType === 'text') {
      // not supported on text at all
      delete opts.transparency;
    } else {
      // move into fill
      if (opts.fill && typeof opts.fill === 'object') {
        opts.fill = { ...opts.fill, transparency: opts.transparency };
      } else {
        opts.fill = { transparency: opts.transparency };
      }
      delete opts.transparency;
    }
  }

  // font aliases
  if (opts.font && !opts.fontFace) { opts.fontFace = opts.font; delete opts.font; }
  if (opts.size && !opts.fontSize) { opts.fontSize = opts.size; delete opts.size; }
  if (opts.fontsize && !opts.fontSize) { opts.fontSize = opts.fontsize; delete opts.fontsize; }

  // align aliases
  if (opts.textAlign && !opts.align) { opts.align = opts.textAlign; delete opts.textAlign; }
  if (opts.verticalAlign && !opts.valign) { opts.valign = opts.verticalAlign; delete opts.verticalAlign; }

  // coerce string booleans
  for (const k of ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'wrap', 'isTextBox', 'autoFit', 'shrinkText']) {
    if (opts[k] === 'true') opts[k] = true;
    else if (opts[k] === 'false') opts[k] = false;
  }

  // coerce string numbers for layout + text fields
  for (const k of ['x', 'y', 'w', 'h', 'fontSize', 'margin', 'charSpacing', 'paraSpaceAfter', 'paraSpaceBefore', 'indentLevel', 'lineSpacingMultiple', 'rotate', 'rectRadius']) {
    if (typeof opts[k] === 'string' && !isNaN(Number(opts[k]))) opts[k] = Number(opts[k]);
  }

  // sanitize nested fill/line/shadow objects too
  if (opts.fill && typeof opts.fill === 'object') opts.fill = stripHashes(opts.fill);
  if (opts.line && typeof opts.line === 'object') opts.line = stripHashes(opts.line);
  if (opts.shadow && typeof opts.shadow === 'object') opts.shadow = stripHashes(opts.shadow);

  return opts;
}

/** Sanitize slide background — strip # from color, handle shorthand. */
function sanitizeBackground(bg: any): any {
  if (!bg) return bg;
  if (typeof bg === 'string') return { color: bg.replace(/^#/, '') };
  const out = { ...bg };
  if (typeof out.color === 'string') out.color = out.color.replace(/^#/, '');
  return out;
}

/**
 * Extract a JSON object from an LLM response string.
 * Handles markdown fences, leading prose, and trailing content.
 */
function extractJson(raw: string): string {
  const text = raw.trim();

  // 1. Try direct parse
  try { JSON.parse(text); return text; } catch {}

  // 2. Strip markdown code fences
  const fenceStripped = text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim();
  try { JSON.parse(fenceStripped); return fenceStripped; } catch {}

  // 3. Find outermost { ... }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const candidate = text.slice(start, end + 1);
    try { JSON.parse(candidate); return candidate; } catch {}
  }

  return text; // let JSON.parse throw with a useful message
}

// ─── Tool ────────────────────────────────────────────────────────────────────

const DEFAULT_PPT_MODEL = 'kimi-latest';

export function createCreatePptTool(): Tool<
  { query: string; num_slides: number },
  XyneAIAgentContext
> {
  return {
    schema: {
      name: 'create_ppt',
      description: getDescription('create_ppt'),
      parameters: z.object({
        query: z.string().describe(
          'Rich presentation brief: topic, purpose, audience, tone, key content points, ' +
          'color/style preferences, and any specific slides or data to include.'
        ),
        num_slides: z.number().int().min(3).max(20).describe(
          'Number of slides to generate (typically 8–12; default 10).'
        ),
      }),
    },
    execute: async (args, context) => {
      const { query, num_slides } = args;
      const model = context.modelName ?? DEFAULT_PPT_MODEL;
      const queryPreview = query.length > 80 ? `${query.slice(0, 80)}...` : query;
      logger.info(`[Tool] [${context.sessionId}] create_ppt: ${num_slides} slides, model=${model}, query="${queryPreview}"`);

      try {
        // ── Step 1: LLM call ────────────────────────────────────────────────
        const userPrompt =
          `Create a ${num_slides}-slide presentation for the following request:\n\n${query}\n\n` +
          `Respond with ONLY the raw JSON object — no markdown fences, no extra text.`;

        const baseUrl = config.litellm.baseUrl.endsWith('/')
          ? config.litellm.baseUrl
          : `${config.litellm.baseUrl}/`;

        const llmRes = await httpsPost(
          `${baseUrl}chat/completions`,
          JSON.stringify({
            model,
            messages: [
              { role: 'system', content: PPTX_DESIGNER_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            thinking: { type: 'disabled' },
          }),
          {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.litellm.apiKey}`,
          }
        );

        if (llmRes.status < 200 || llmRes.status >= 300) {
          throw new Error(`LLM call failed: ${llmRes.status} — ${llmRes.text.slice(0, 300)}`);
        }

        const llmData = JSON.parse(llmRes.text) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const rawContent = llmData.choices?.[0]?.message?.content;
        if (!rawContent) throw new Error('Empty LLM response');

        logger.info(`[Tool] [${context.sessionId}] create_ppt: LLM returned ${rawContent.length} chars`);

        // ── Step 2: Parse JSON ──────────────────────────────────────────────
        let pptConfig: { title?: string; layout?: string; slides: any[] };
        try {
          pptConfig = JSON.parse(extractJson(rawContent));
        } catch (parseErr) {
          logger.error(`[Tool] [${context.sessionId}] create_ppt: JSON parse failed.\n${rawContent.slice(0, 600)}`);
          throw new Error(`LLM returned invalid JSON: ${parseErr instanceof Error ? parseErr.message : parseErr}`);
        }

        const { title = query.slice(0, 60), layout = 'LAYOUT_16x9', slides } = pptConfig;

        if (!Array.isArray(slides) || slides.length === 0) {
          throw new Error('LLM returned no slides');
        }

        // ── Step 3: Render ──────────────────────────────────────────────────
        const PptxGenJS = (await import('pptxgenjs')).default;
        const pptx = new PptxGenJS();
        pptx.layout = layout;
        pptx.title = title;
        pptx.author = 'Xyne AI';

        const pptxShapes = (pptx as any).shapes as Record<string, any>;
        const pptxCharts = (pptx as any).charts as Record<string, any>;

        let skippedObjects = 0;

        for (let si = 0; si < slides.length; si++) {
          const slideConfig = slides[si];
          let slide: any;
          try {
            slide = pptx.addSlide();

            if (slideConfig.background) {
              slide.background = sanitizeBackground(slideConfig.background);
            }
          } catch (slideErr) {
            logger.warn(`[Tool] [${context.sessionId}] create_ppt: slide ${si + 1} init failed, skipping: ${slideErr}`);
            skippedObjects++;
            continue;
          }

          // Support both 'objects' and 'elements' field names
          const items: any[] = slideConfig.objects ?? slideConfig.elements ?? slideConfig.content ?? [];

          for (let oi = 0; oi < items.length; oi++) {
            const obj = items[oi];
            if (!obj || typeof obj !== 'object') continue;

            try {
              const type: string = (obj.type ?? '').toLowerCase();
              const opts = sanitizeOptions(obj.options ?? {}, type);

              switch (type) {
                case 'text': {
                  const content = Array.isArray(obj.text)
                    ? obj.text.map((r: any) => ({
                        text: String(r.text ?? r.value ?? ''),
                        options: sanitizeOptions(r.options ?? {}, 'text'),
                      }))
                    : String(obj.text ?? obj.value ?? '');
                  slide.addText(content, opts);
                  break;
                }

                case 'shape':
                case 'rect':
                case 'rectangle': {
                  const rawKey: string = (obj.shape ?? obj.shape_type ?? (type === 'rect' || type === 'rectangle' ? 'RECTANGLE' : 'RECTANGLE')).toUpperCase();
                  const shapeVal = pptxShapes[rawKey] ?? pptxShapes.RECTANGLE;
                  slide.addShape(shapeVal, opts);
                  break;
                }

                case 'image': {
                  // merge top-level src/path/data into options
                  const imgOpts: any = { ...opts };
                  if (!imgOpts.path && !imgOpts.data && obj.src) imgOpts.path = obj.src;
                  if (!imgOpts.path && !imgOpts.data && obj.url) imgOpts.path = obj.url;
                  slide.addImage(imgOpts);
                  break;
                }

                case 'chart': {
                  const rawChartKey: string = (obj.chart_type ?? obj.chartType ?? obj.type ?? 'BAR').toUpperCase();
                  const chartVal = pptxCharts[rawChartKey] ?? pptxCharts.BAR;
                  // Normalise data: support { labels, values, name } shorthand
                  const rawData: any[] = obj.data ?? obj.chart_data ?? [];
                  const chartData = rawData.map((s: any) => {
                    if (Array.isArray(s)) return s; // already array of cell values
                    return {
                      name: s.name ?? s.series ?? s.label ?? 'Series',
                      labels: s.labels ?? s.categories ?? [],
                      values: s.values ?? s.data ?? [],
                    };
                  });
                  slide.addChart(chartVal, chartData, opts);
                  break;
                }

                case 'table': {
                  const rows = obj.rows ?? obj.data ?? [];
                  // Normalise rows: each cell can be a string or { text, options } object
                  const normRows = rows.map((row: any) =>
                    Array.isArray(row)
                      ? row.map((cell: any) =>
                          typeof cell === 'string' || typeof cell === 'number'
                            ? { text: String(cell) }
                            : { text: String(cell.text ?? cell.value ?? ''), options: sanitizeOptions(cell.options ?? {}, 'text') }
                        )
                      : []
                  );
                  slide.addTable(normRows, opts);
                  break;
                }

                case 'notes':
                  slide.addNotes(String(obj.text ?? obj.notes ?? ''));
                  break;

                default:
                  // Unknown type — skip silently
                  logger.debug(`[Tool] [${context.sessionId}] create_ppt: unknown object type "${obj.type}" on slide ${si + 1}, skipping`);
                  skippedObjects++;
              }
            } catch (objErr) {
              // One bad object should never kill the whole presentation
              skippedObjects++;
              logger.warn(
                `[Tool] [${context.sessionId}] create_ppt: slide ${si + 1} obj ${oi + 1} (type="${obj.type}") failed — skipping: ${objErr instanceof Error ? objErr.message : objErr}`
              );
            }
          }
        }

        if (skippedObjects > 0) {
          logger.warn(`[Tool] [${context.sessionId}] create_ppt: ${skippedObjects} objects skipped due to errors`);
        }

        // ── Step 4: Write buffer ────────────────────────────────────────────
        const buffer = Buffer.from(
          await pptx.write({ outputType: 'nodebuffer' }) as ArrayBuffer
        );

        // ── Step 5: Upload to GCS & save to MessageAttachment ─────────────
        const pptxMimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
        const filename = `${safeTitle}.pptx`;

        const gcsResult = await storageService.uploadFile(buffer, {
          filename,
          contentType: pptxMimeType,
          metadata: { title, source: 'xyne-ai-create-ppt' },
          scopeType: 'ASKAI',
          scopeId: context.sessionId,
        });

        const messageAttachmentRepo = new MessageAttachmentRepository();
        const attachment = await messageAttachmentRepo.create({
          entityId: context.conversationId ?? context.sessionId,
          entityType: AttachmentEntityType.CHAT,
          originalFilename: filename,
          size: gcsResult.size,
          mimetype: pptxMimeType,
          url: gcsResult.path,
          uploadedByUserId: context.userId,
          createdBy: context.userId,
          storageProvider: config.fileStorage.provider,
          conversationId: context.conversationId ?? null,
          metadata: { title, type: 'presentation', source: 'create_ppt' },
        });

        logger.info(
          `[Tool] [${context.sessionId}] create_ppt: uploaded ${gcsResult.path} (${(buffer.length / 1024).toFixed(0)}KB), attachmentId=${attachment.id}`
        );

        // ── Step 6: Return download URL ─────────────────────────────────────
        const isLocalDev = (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') && config.gcs.fakeGcsHost;
        const downloadUrl = isLocalDev
          ? `http://${config.gcs.fakeGcsHost}/download/storage/v1/b/${config.gcs.bucketName}/o/${encodeURIComponent(gcsResult.path)}?alt=media`
          : `/api/attachments/${attachment.id}/download`;

        return downloadUrl;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        const cause = error instanceof Error ? (error as any).cause : undefined;
        logger.error(`[Tool] [${context.sessionId}] create_ppt error: ${msg}`, cause ?? error);
        return `Error creating presentation: ${msg}`;
      }
    },
  };
}

export function getCreatePptTool() {
  return createCreatePptTool();
}
