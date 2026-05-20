import { Router, Request, Response } from 'express';
import { authMiddleware } from '@/middleware/auth';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import vespaClient from '@/vespa/client';
import { NAMESPACE, CLUSTER } from '@/vespa/vespaConfig';
import {
  channelSchema,
  projectSchema,
  fileSchema,
  mailSchema,
  samTranscriptSchema,
  memorySchema,
  userSchema,
  type VespaSchema,
} from '@/vespa/src/types';

const router = Router();

// ─── Vespa config ────────────────────────────────────────────────────────────

const FEED_ENDPOINT = process.env.VESPA_FEED_URL || 'http://127.0.0.1:8080';
const VESPA_NAMESPACE = NAMESPACE;
const VESPA_CLUSTER = CLUSTER;

// ─── In-memory job registry (lost on pod restart — acceptable for one-time) ───

interface JobStats {
  schema: string;
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
  notFound: number;
  running: boolean;
  error?: string;
}

const jobs = new Map<string, JobStats>();

// ─── Workspace / org cache ───────────────────────────────────────────────────

const workspaceOrgCache = new Map<string, string>();

async function getOrgId(workspaceId: string): Promise<string | null> {
  if (workspaceOrgCache.has(workspaceId)) return workspaceOrgCache.get(workspaceId)!;
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { orgId: true },
  });
  if (ws?.orgId) {
    workspaceOrgCache.set(workspaceId, ws.orgId);
    return ws.orgId;
  }
  return null;
}

// ─── Vespa visit helper ──────────────────────────────────────────────────────

interface VespaDoc {
  id: string;
  fields: Record<string, any>;
}

async function* visitAll(schema: string, batchSize = 100): AsyncGenerator<VespaDoc> {
  let continuation: string | undefined;
  do {
    const params = new URLSearchParams({
      wantedDocumentCount: batchSize.toString(),
      cluster: VESPA_CLUSTER,
      fieldSet: `${schema}:[document]`,
      ...(continuation ? { continuation } : {}),
    });

    const url = `${FEED_ENDPOINT}/document/v1/${VESPA_NAMESPACE}/${schema}/docid?${params}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`Visit ${schema} failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      documents?: VespaDoc[];
      continuation?: string;
    };

    for (const doc of data.documents ?? []) yield doc;
    continuation = data.continuation;
  } while (continuation);
}

// ─── Resolver helpers ────────────────────────────────────────────────────────

async function resolveChannel(docId: string): Promise<{ workspaceId: string; orgId: string } | null> {
  const channel = await db.channel.findUnique({
    where: { id: docId },
    select: { workspaceId: true },
  });
  if (!channel?.workspaceId) return null;
  const orgId = await getOrgId(channel.workspaceId);
  if (!orgId) return null;
  return { workspaceId: channel.workspaceId, orgId };
}

async function resolveProject(docId: string): Promise<{ workspaceId: string; orgId: string } | null> {
  const project = await db.project.findUnique({
    where: { id: docId },
    select: { workspaceId: true },
  });
  if (!project?.workspaceId) return null;
  const orgId = await getOrgId(project.workspaceId);
  if (!orgId) return null;
  return { workspaceId: project.workspaceId, orgId };
}

async function resolveFile(docId: string): Promise<{ workspaceId: string; orgId: string } | null> {
  const attachment = await db.messageAttachment.findUnique({
    where: { id: docId },
    select: { workspaceId: true },
  });
  if (attachment?.workspaceId) {
    const orgId = await getOrgId(attachment.workspaceId);
    if (orgId) return { workspaceId: attachment.workspaceId, orgId };
  }

  const canvas = await db.canvas.findUnique({
    where: { id: docId },
    select: { channelId: true },
  });
  if (canvas?.channelId) {
    const channel = await db.channel.findUnique({
      where: { id: canvas.channelId },
      select: { workspaceId: true },
    });
    if (channel?.workspaceId) {
      const orgId = await getOrgId(channel.workspaceId);
      if (orgId) return { workspaceId: channel.workspaceId, orgId };
    }
  }

  const call = await db.call.findUnique({
    where: { id: docId },
    select: { channelId: true },
  });
  if (call?.channelId) {
    const channel = await db.channel.findUnique({
      where: { id: call.channelId },
      select: { workspaceId: true },
    });
    if (channel?.workspaceId) {
      const orgId = await getOrgId(channel.workspaceId);
      if (orgId) return { workspaceId: channel.workspaceId, orgId };
    }
  }

  // RCA: docId is the RCA id → ticketId → ticket.workspaceId
  const rca = await db.rCA.findUnique({
    where: { id: docId },
    select: { ticketId: true },
  });
  if (rca?.ticketId) {
    const ticket = await db.ticket.findUnique({
      where: { id: rca.ticketId },
      select: { workspaceId: true },
    });
    if (ticket?.workspaceId) {
      const orgId = await getOrgId(ticket.workspaceId);
      if (orgId) return { workspaceId: ticket.workspaceId, orgId };
    }
  }

  return null;
}

async function resolveMail(docId: string): Promise<{ workspaceId: string; orgId: string } | null> {
  const email = await db.email.findUnique({
    where: { id: docId },
    select: { conversationId: true },
  });
  if (!email?.conversationId) return null;
  const conv = await db.conversation.findUnique({
    where: { conversationId: email.conversationId },
    select: { channelId: true },
  });
  if (!conv?.channelId) return null;
  const channel = await db.channel.findUnique({
    where: { id: conv.channelId },
    select: { workspaceId: true },
  });
  if (!channel?.workspaceId) return null;
  const orgId = await getOrgId(channel.workspaceId);
  if (!orgId) return null;
  return { workspaceId: channel.workspaceId, orgId };
}

async function resolveSamTranscript(docId: string): Promise<{ workspaceId: string; orgId: string } | null> {
  const call = await db.call.findUnique({
    where: { id: docId },
    select: { channelId: true },
  });
  if (!call?.channelId) return null;
  const channel = await db.channel.findUnique({
    where: { id: call.channelId },
    select: { workspaceId: true },
  });
  if (!channel?.workspaceId) return null;
  const orgId = await getOrgId(channel.workspaceId);
  if (!orgId) return null;
  return { workspaceId: channel.workspaceId, orgId };
}

async function resolveMemory(_docId: string, fields: Record<string, any>): Promise<{ workspaceId: string; orgId: string } | null> {
  const userId: string | undefined = fields.userId;
  if (userId) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { workspaceId: true },
    });
    if (user?.workspaceId) {
      const orgId = await getOrgId(user.workspaceId);
      if (orgId) return { workspaceId: user.workspaceId, orgId };
    }
  }
  return null;
}

async function resolveUser(docId: string): Promise<{ workspaceId: string; orgId: string } | null> {
  const user = await db.user.findUnique({
    where: { id: docId },
    select: { workspaceId: true },
  });
  if (!user?.workspaceId) return null;
  const orgId = await getOrgId(user.workspaceId);
  if (!orgId) return null;
  return { workspaceId: user.workspaceId, orgId };
}

// ─── Schema config ───────────────────────────────────────────────────────────

interface SchemaConfig {
  schema: VespaSchema;
  resolve: (docId: string, fields: Record<string, any>) => Promise<{ workspaceId: string; orgId: string } | null>;
}

const SCHEMAS_TO_BACKFILL: SchemaConfig[] = [
  { schema: channelSchema,       resolve: (id) => resolveChannel(id) },
  { schema: projectSchema,       resolve: (id) => resolveProject(id) },
  { schema: fileSchema,          resolve: (id) => resolveFile(id) },
  { schema: mailSchema,          resolve: (id) => resolveMail(id) },
  { schema: samTranscriptSchema, resolve: (id) => resolveSamTranscript(id) },
  { schema: memorySchema,        resolve: (id, fields) => resolveMemory(id, fields) },
  { schema: userSchema,          resolve: (id) => resolveUser(id) },
];

// ─── Backfill engine ─────────────────────────────────────────────────────────

async function backfillSchema(
  schemaConfig: SchemaConfig,
  delayMs: number,
  stats: JobStats,
): Promise<void> {
  const { schema, resolve } = schemaConfig;
  const batch: { docId: string; workspaceId: string; orgId: string }[] = [];

  const flushBatch = async () => {
    if (batch.length === 0) return;
    try {
      const updates = batch.map(({ docId, workspaceId, orgId }) => ({
        docId,
        fields: { workspaceId, orgId },
      }));
      const results = await vespaClient.crudService.update(updates, schema);
      const failedCount = results.filter((r) => !r.success).length;
      stats.updated += results.length - failedCount;
      stats.failed += failedCount;
      if (failedCount > 0) {
        logger.warn(
          `[VespaBackfill] Batch update partially failed for ${schema}: ${failedCount}/${results.length} failed`,
        );
      }
    } catch (err) {
      logger.error(`[VespaBackfill] Batch update failed for ${schema}: ${(err as Error).message}`);
      stats.failed += batch.length;
    } finally {
      batch.length = 0;
    }
  };

  for await (const doc of visitAll(schema)) {
    stats.processed++;
    const docId = doc.id.split('::').pop() || doc.id;
    const { fields } = doc;

    // Skip if already populated
    if (fields.workspaceId && fields.orgId) {
      stats.skipped++;
      continue;
    }

    const resolved = await resolve(docId, fields);
    if (!resolved) {
      logger.warn(`[VespaBackfill] [${schema}] ${docId}: could not resolve workspaceId/orgId — skipping`);
      stats.notFound++;
      continue;
    }

    batch.push({ docId, workspaceId: resolved.workspaceId, orgId: resolved.orgId });

    // Flush batch every 20 docs or sleep and flush if delayMs is set
    if (batch.length >= 20) {
      await flushBatch();
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  // Flush remaining
  await flushBatch();
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * POST /api/migration/vespa-workspace-backfill/trigger
 * POST /migrate/api/migration/vespa-workspace-backfill/trigger
 *
 * Body: { schema?: string, delayMs?: number }
 * Query: ?schema=chat_container&delayMs=50
 */
router.post('/trigger', authMiddleware.authenticate, async (req: Request, res: Response) => {
  try {
    const schemaFilter = (req.body.schema as string) || (req.query.schema as string);
    const delayMs = Number(req.body.delayMs ?? req.query.delayMs ?? 50);

    const schemas = schemaFilter
      ? SCHEMAS_TO_BACKFILL.filter((s) => s.schema === schemaFilter)
      : SCHEMAS_TO_BACKFILL;

    if (schemas.length === 0) {
      return res.status(400).json({
        error: `Unknown schema "${schemaFilter}". Valid: ${SCHEMAS_TO_BACKFILL.map((s) => s.schema).join(', ')}`,
      });
    }

    const jobId = `vespa-ws-backfill-${Date.now()}`;
    const stats: JobStats = {
      schema: schemas.map((s) => s.schema).join(','),
      processed: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      notFound: 0,
      running: true,
    };
    jobs.set(jobId, stats);

    // Fire-and-forget backfill
    (async () => {
      try {
        for (const sc of schemas) {
          logger.info(`[VespaBackfill] Starting backfill for schema: ${sc.schema}`);
          await backfillSchema(sc, delayMs, stats);
          logger.info(`[VespaBackfill] Completed schema: ${sc.schema}`);
        }
      } catch (err) {
        stats.error = (err as Error).message;
        logger.error(`[VespaBackfill] Job ${jobId} failed:`, err);
      } finally {
        stats.running = false;
      }
    })();

    return res.status(202).json({
      jobId,
      message: 'Backfill started in background',
      schemas: schemas.map((s) => s.schema),
      delayMs,
      statusEndpoint: `/migrate/api/migration/vespa-workspace-backfill/status/${jobId}`,
    });
  } catch (err) {
    logger.error('[VespaBackfill] Trigger failed:', err);
    return res.status(500).json({ error: 'Failed to trigger backfill', message: (err as Error).message });
  }
});

/**
 * GET /api/migration/vespa-workspace-backfill/status/:jobId
 * GET /migrate/api/migration/vespa-workspace-backfill/status/:jobId
 */
router.get('/status/:jobId', authMiddleware.authenticate, (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  const stats = jobs.get(jobId);
  if (!stats) {
    return res.status(404).json({ error: 'Job not found', jobId });
  }
  return res.json({ jobId, ...stats });
});

export default router;