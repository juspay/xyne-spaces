import { PrismaClient } from '@prisma/client';
import { sanitizeCanvasContent } from '@xyne/shared';
import { logger } from '@/utils/logger';

const CANVAS_CONTENT_MODELS = new Set(['Canvas', 'CanvasVersion']);
const CANVAS_WRITE_ACTIONS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert']);

type WriteData = Record<string, unknown> | undefined;

const repairContent = (data: WriteData, model: string, action: string): void => {
  if (!data || !('content' in data)) return;
  const { content, changed } = sanitizeCanvasContent(data['content']);
  if (!changed) return;
  data['content'] = content;
  logger.warn('[CanvasContentSanitize] Repaired canvas content', { model, action });
};

export function setupCanvasContentSanitize(prisma: PrismaClient): void {
  prisma.$use(async (params, next) => {
    if (
      params.model &&
      CANVAS_CONTENT_MODELS.has(params.model) &&
      CANVAS_WRITE_ACTIONS.has(params.action)
    ) {
      const args = (params.args ?? {}) as Record<string, unknown>;
      try {
        if (params.action === 'upsert') {
          repairContent(args['create'] as WriteData, params.model, params.action);
          repairContent(args['update'] as WriteData, params.model, params.action);
        } else {
          const data = args['data'];
          for (const row of Array.isArray(data) ? data : [data]) {
            repairContent(row as WriteData, params.model, params.action);
          }
        }
      } catch (error) {
        logger.error('[CanvasContentSanitize] Failed to sanitize canvas content', {
          model: params.model,
          action: params.action,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return next(params);
  });
}
