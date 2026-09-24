import { Router, type Request, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { FormEntityType } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Rows read before distinct values are taken. The table holds a row per (ticket, field), so
 * this keeps the dropdown's cost flat. `q` is matched in the same window rather than pushed
 * down: the value is a Json column the query builder can't filter case-insensitively, and
 * raw SQL is barred (scripts/validate-no-raw-sql.sh). Older values can still be typed in.
 */
const SCAN_LIMIT = 5000;

const ListFieldValuesQuerySchema = z.object({
  fieldId: z.string().trim().min(1).max(200),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

type StoredValueRow = {
  fieldValue: string;
  actualFieldValue: Prisma.JsonValue | null;
};

/**
 * The values one row contributes. `actualFieldValue` is what every write path fills;
 * `fieldValue` is a fallback for older rows (the Zero mutator writes `''` there). A
 * multi-value field holds an array, and each element is its own option.
 */
const extractStoredValues = (row: StoredValueRow): string[] => {
  const actual = row.actualFieldValue;
  if (Array.isArray(actual)) {
    return actual
      .filter(
        (element): element is string | number | boolean =>
          typeof element === 'string' || typeof element === 'number' || typeof element === 'boolean',
      )
      .map(String);
  }
  if (typeof actual === 'string' || typeof actual === 'number' || typeof actual === 'boolean') {
    return [String(actual)];
  }
  return [row.fieldValue];
};

/**
 * List the values already stored for one custom form field, so its filter can offer them as
 * a dropdown instead of a blind text box. Ordered by how often each value occurs.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const parsed = ListFieldValuesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Validation error',
        details: parsed.error.errors,
      });
      return;
    }

    const { fieldId, q, limit } = parsed.data;

    // Workspace-scoped by the tenant ACL extension (see database/tenant/acl-extension.ts).
    const rows = await db.formEntityValues.findMany({
      where: { fieldId, entityType: FormEntityType.TICKET },
      select: { fieldValue: true, actualFieldValue: true },
      orderBy: { updatedAt: 'desc' },
      take: SCAN_LIMIT,
    });

    const search = q?.toLowerCase();
    const countByValue = new Map<string, number>();
    for (const row of rows) {
      for (const value of extractStoredValues(row)) {
        const trimmed = value.trim();
        if (!trimmed) continue;
        if (search && !trimmed.toLowerCase().includes(search)) continue;
        countByValue.set(trimmed, (countByValue.get(trimmed) ?? 0) + 1);
      }
    }

    const ranked = [...countByValue.entries()]
      .sort(([leftValue, leftCount], [rightValue, rightCount]) =>
        leftCount === rightCount ? leftValue.localeCompare(rightValue) : rightCount - leftCount,
      )
      .map(([value]) => value);

    res.status(200).json({
      success: true,
      values: ranked.slice(0, limit),
      // The client shows a "refine your search" hint rather than paginating.
      hasMore: ranked.length > limit,
    });
  } catch (error) {
    logger.error('[FormFieldValueRoutes] Failed to list form field values:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
