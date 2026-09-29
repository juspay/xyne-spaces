import { PrismaClient } from '@prisma/client';
import { sanitizeCanvasContent } from '@xyne/shared';
import { logger } from '@/utils/logger';

/**
 * Models whose `content` column holds a BlockNote block array that the canvas
 * editor loads with `initialContent`.
 */
const CANVAS_CONTENT_MODELS = new Set(['Canvas', 'CanvasVersion']);

const CANVAS_WRITE_ACTIONS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert']);

type WriteData = Record<string, unknown> | undefined;

interface RepairContext {
  model: string;
  action: string;
  where: unknown;
}

/**
 * Repair `data.content` in place and log what changed. Returns nothing: the
 * middleware mutates `params.args` so every writer below it sees the repaired
 * content without having to know this middleware exists.
 */
const repairContent = (data: WriteData, context: RepairContext): void => {
  if (!data || !('content' in data)) return;

  const { content, report } = sanitizeCanvasContent(data['content']);
  if (!report.changed) return;

  data['content'] = content;
  logger.warn('[CanvasContentSanitize] Repaired canvas content in Prisma write', {
    model: context.model,
    action: context.action,
    // Only the id is useful for tracing the row; the rest of `where` can be large.
    canvasId:
      (context.where as { id?: unknown } | undefined)?.id ??
      (data['canvasId'] as string | undefined) ??
      (data['id'] as string | undefined),
    ...report,
  });
};

/**
 * Prisma middleware that repairs canvas content on every Prisma write
 * (XYNE-65102).
 *
 * Canvas content is written from many backend services: the REST controller,
 * the markdown converter used by agents and imports, call documents, release
 * notes, SDLC wiki pages, Confluence/Jira/Slack migrations, and more. Fixing
 * each writer one by one would miss the next one added, so the repair sits at
 * the client, where no writer can skip it.
 *
 * Not covered here, and handled elsewhere:
 *   - Zero mutators write straight to Postgres. They call
 *     `sanitizeCanvasContentForWrite` in `src/zero/mutators.ts`.
 *   - Raw SQL and manual database edits skip every application layer. The
 *     dashboard runs the same sanitizer before loading content into the
 *     editor, and a render error boundary contains anything that still fails.
 *
 * The repair never throws: a failure here would block the save, which is
 * worse than storing content the frontend can still repair on read.
 */
export function setupCanvasContentSanitize(prisma: PrismaClient): void {
  prisma.$use(async (params, next) => {
    if (
      params.model &&
      CANVAS_CONTENT_MODELS.has(params.model) &&
      CANVAS_WRITE_ACTIONS.has(params.action)
    ) {
      const args = (params.args ?? {}) as Record<string, unknown>;
      const context: RepairContext = {
        model: params.model,
        action: params.action,
        where: args['where'],
      };

      try {
        switch (params.action) {
          case 'upsert':
            repairContent(args['create'] as WriteData, context);
            repairContent(args['update'] as WriteData, context);
            break;
          case 'createMany': {
            const data = args['data'];
            const rows = Array.isArray(data) ? data : [data];
            for (const row of rows) {
              repairContent(row as WriteData, context);
            }
            break;
          }
          default:
            repairContent(args['data'] as WriteData, context);
        }
      } catch (error) {
        logger.error('[CanvasContentSanitize] Failed to sanitize canvas content; writing as-is', {
          model: params.model,
          action: params.action,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return next(params);
  });
}
