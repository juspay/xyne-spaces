import { Router, Request, Response } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';

/**
 * Entity registry reads for the Entities page — /api/entities
 *
 * Registry only. The MESSAGES behind an entity are a Vespa concern, so the page
 * calls the shared search endpoint directly:
 *   GET /api/vespaSearch?filterOnly=true&type=messages&entityId=<id>
 * That already owns permission scoping, offset/limit paging and the result shape,
 * so there is deliberately no wrapper for it here.
 */

const prisma = DatabaseClient.getInstance();
const router = Router();

const MAX_LIMIT = 100;

/** GET /api/entities?type=&limit=&offset= — the registry, busiest entities first. */
router.get('/', authMiddleware.authenticate, async (req: Request, res: Response) => {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) return res.status(401).json({ error: 'Unauthorized' });

  const type = typeof req.query['type'] === 'string' ? req.query['type'] : undefined;
  const limit = Math.max(1, Math.min(Number(req.query['limit']) || 50, MAX_LIMIT));
  const offset = Math.max(Number(req.query['offset']) || 0, 0);

  const where = {
    workspaceId,
    ...(type ? { type } : {}),
  };

  try {
    const [rows, total] = await Promise.all([
      prisma.entity.findMany({
        where,
        orderBy: [{ mentionCount: 'desc' }, { canonicalName: 'asc' }],
        skip: offset,
        take: limit,
        select: {
          id: true,
          type: true,
          canonicalName: true,
          mentionCount: true,
          _count: { select: { aliases: true } },
          // The spellings that resolve to this entity. The client needs them to
          // highlight a mention: a message's `entitySurfaceForms` is the whole
          // thread's set with no mapping back to an id, so the only way to know
          // which span belongs to THIS entity is its alias list.
          aliases: { select: { surfaceForm: true }, orderBy: { count: 'desc' }, take: 25 },
        },
      }),
      prisma.entity.count({ where }),
    ]);

    return res.json({
      entities: rows.map(r => ({
        id: r.id,
        type: r.type,
        canonicalName: r.canonicalName,
        mentionCount: r.mentionCount,
        aliasCount: r._count.aliases,
        aliases: r.aliases.map(a => a.surfaceForm),
      })),
      total,
    });
  } catch (error) {
    logger.error('[ENTITIES] list failed:', error);
    return res.status(500).json({ error: 'Failed to list entities' });
  }
});

/** GET /api/entities/types — distinct types in the workspace, for the filter chips. */
router.get('/types', authMiddleware.authenticate, async (req: Request, res: Response) => {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // groupBy, not distinct: Prisma does not push `distinct` down to SQL — it emits
    // `SELECT id, type FROM entities WHERE workspaceId = $1` and deduplicates in the
    // client, so it reads the workspace's whole entity table on every page load.
    // groupBy emits a real GROUP BY, served by @@index([workspaceId, type]).
    const rows = await prisma.entity.groupBy({
      by: ['type'],
      where: { workspaceId },
      orderBy: { type: 'asc' },
    });
    return res.json({ types: rows.map(r => r.type) });
  } catch (error) {
    logger.error('[ENTITIES] list types failed:', error);
    return res.status(500).json({ error: 'Failed to list entity types' });
  }
});

/**
 * GET /api/entities/:entityId/feedback — every review recorded for this entity.
 *
 * Scoped to one entity rather than paged: the client renders at most a few dozen
 * threads at a time and needs to look feedback up by messageId, so one fetch keyed
 * on the entity is cheaper than a lookup per card.
 */
router.get('/:entityId/feedback', authMiddleware.authenticate, async (req: Request, res: Response) => {
  const workspaceId = req.user?.workspaceId;
  const userId = req.user?.id;
  if (!workspaceId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const entityId = req.params['entityId'];
  if (!entityId) return res.status(400).json({ error: 'entityId is required' });

  try {
    const rows = await prisma.entityFeedback.findMany({
      where: { workspaceId, entityId },
      select: {
        messageId: true,
        conversationId: true,
        entityId: true,
        verdict: true,
        remarks: true,
        createdBy: true,
        updatedAt: true,
      },
    });
    // Every reviewer's rows come back, so the client can show a tally — it needs
    // the caller's id to pick out which one is the viewer's own verdict.
    return res.json({ feedback: rows, currentUserId: userId });
  } catch (error) {
    logger.error('[ENTITIES] list feedback failed:', error);
    return res.status(500).json({ error: 'Failed to load feedback' });
  }
});

/**
 * PUT /api/entities/:entityId/feedback/:messageId — record a review of one entity
 * on one message.
 *
 * Upsert on (messageId, entityId, createdBy): re-reviewing replaces YOUR previous
 * verdict rather than accumulating rows, while another reviewer's verdict on the
 * same message is left alone. Approving clears any earlier remark; rejecting
 * requires one, since the remark is the point of a rejection.
 */
router.put(
  '/:entityId/feedback/:messageId',
  authMiddleware.authenticate,
  async (req: Request, res: Response) => {
    const workspaceId = req.user?.workspaceId;
    const userId = req.user?.id;
    if (!workspaceId || !userId) return res.status(401).json({ error: 'Unauthorized' });

    const entityId = req.params['entityId'];
    const messageId = req.params['messageId'];
    if (!entityId || !messageId) {
      return res.status(400).json({ error: 'entityId and messageId are required' });
    }

    const { verdict, remarks } = req.body as { verdict?: unknown; remarks?: unknown };
    if (verdict !== 'APPROVED' && verdict !== 'REJECTED') {
      return res.status(400).json({ error: "verdict must be 'APPROVED' or 'REJECTED'" });
    }
    if (verdict === 'REJECTED' && (typeof remarks !== 'string' || !remarks.trim())) {
      return res.status(400).json({ error: 'remarks is required when rejecting' });
    }

    const cleanRemarks =
      verdict === 'REJECTED' ? (remarks as string).trim().slice(0, 1000) : null;

    try {
      // Both ids come from the URL, so verify they belong to this workspace before
      // writing — otherwise feedback could be attached to another tenant's message.
      const [entity, message] = await Promise.all([
        prisma.entity.findFirst({ where: { id: entityId, workspaceId }, select: { id: true } }),
        prisma.message.findFirst({
          where: { messageId, workspaceId },
          select: { conversationId: true },
        }),
      ]);
      if (!entity) return res.status(404).json({ error: 'Entity not found' });
      if (!message) return res.status(404).json({ error: 'Message not found' });

      const row = await prisma.entityFeedback.upsert({
        where: { messageId_entityId_createdBy: { messageId, entityId, createdBy: userId } },
        create: {
          workspaceId,
          messageId,
          conversationId: message.conversationId,
          entityId,
          verdict,
          remarks: cleanRemarks,
          createdBy: userId,
        },
        // createdBy is part of the key, so it is never reassigned here — a reviewer
        // only ever edits their own row.
        update: { verdict, remarks: cleanRemarks },
        select: {
          messageId: true,
          conversationId: true,
          entityId: true,
          verdict: true,
          remarks: true,
          createdBy: true,
          updatedAt: true,
        },
      });
      return res.json(row);
    } catch (error) {
      logger.error('[ENTITIES] save feedback failed:', error);
      return res.status(500).json({ error: 'Failed to save feedback' });
    }
  },
);

export default router;
