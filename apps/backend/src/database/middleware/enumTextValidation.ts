import { PrismaClient } from '@prisma/client';
import { assertEnumTextForModel } from '@/validation/enumTextFields';
import { logger } from '@/utils/logger';

const WRITE_ACTIONS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert']);

export function setupEnumTextValidation(prisma: PrismaClient): void {
  prisma.$use(async (params, next) => {
    if (params.model && WRITE_ACTIONS.has(params.action)) {
      const args = (params.args ?? {}) as Record<string, unknown>;

      try {
        switch (params.action) {
          case 'upsert':
            assertEnumTextForModel(params.model, args.create as Record<string, unknown>);
            assertEnumTextForModel(params.model, args.update as Record<string, unknown>);
            break;
          case 'createMany': {
            const data = args.data;
            const rows = Array.isArray(data) ? data : [data];
            for (const row of rows) {
              assertEnumTextForModel(params.model, row as Record<string, unknown>);
            }
            break;
          }
          default:
            assertEnumTextForModel(params.model, args.data as Record<string, unknown>);
        }
      } catch (error) {
        logger.error('[EnumTextValidation] Rejected Prisma write', {
          model: params.model,
          action: params.action,
          reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    return next(params);
  });
}
