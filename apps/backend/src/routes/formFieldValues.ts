import { Router, type Request, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { FormEntityType } from '@xyne/shared';
import { db } from '@/database/client';
import { cacheManager } from '@/utils/cacheManager';
import { logger } from '@/utils/logger';

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Distinct value groups read per aggregate — a backstop for a field used as free text, not the
 * normal path. Groups arrive by count, so the cap only drops the rarest values.
 */
const GROUP_LIMIT = 1000;

/**
 * How long one field's value list is reused. The aggregate scans every row of the field, so it
 * must not run per keystroke; short enough that a newly typed value shows up on the next open.
 */
const CACHE_TTL_SECONDS = 30;

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
    const workspaceId = req.user?.workspaceId;
    if (!req.user?.id || !workspaceId) {
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

    // The whole list is cached per workspace + field, and `q`/`limit` are applied to it below,
    // so a debounced search filters in memory instead of re-running the aggregate per keystroke.
    const cacheKey = `form-field-values:${workspaceId}:${fieldId}`;
    let ranked = cacheManager.get<string[]>(cacheKey);

    if (!ranked) {
      // Grouped in the database so only distinct values cross the wire. Both columns are grouped
      // because `fieldValue` is the fallback for rows without `actualFieldValue`. Workspace-scoped
      // by the tenant ACL extension (see database/tenant/acl-extension.ts).
      const groups = await db.formEntityValues.groupBy({
        by: ['actualFieldValue', 'fieldValue'],
        where: { fieldId, entityType: FormEntityType.TICKET },
        _count: { fieldValue: true },
        orderBy: { _count: { fieldValue: 'desc' } },
        take: GROUP_LIMIT,
      });

      // Keyed case-insensitively so "MID 1" and "mid 1" are one option. Groups arrive by count,
      // so the spelling kept is the most common one.
      const tallyByKey = new Map<string, { value: string; count: number }>();
      for (const group of groups) {
        for (const value of extractStoredValues(group)) {
          const trimmed = value.trim();
          if (!trimmed) continue;
          const key = trimmed.toLowerCase();
          const tally = tallyByKey.get(key);
          if (tally) {
            tally.count += group._count.fieldValue;
          } else {
            tallyByKey.set(key, { value: trimmed, count: group._count.fieldValue });
          }
        }
      }

      ranked = [...tallyByKey.values()]
        .sort((left, right) =>
          left.count === right.count
            ? left.value.localeCompare(right.value)
            : right.count - left.count,
        )
        .map(tally => tally.value);

      cacheManager.set(cacheKey, ranked, CACHE_TTL_SECONDS);
    }

    const search = q?.toLowerCase();
    const matches = search ? ranked.filter(value => value.toLowerCase().includes(search)) : ranked;

    res.status(200).json({
      success: true,
      values: matches.slice(0, limit),
      // The client shows a "refine your search" hint rather than paginating.
      hasMore: matches.length > limit,
    });
  } catch (error) {
    logger.error('[FormFieldValueRoutes] Failed to list form field values:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
