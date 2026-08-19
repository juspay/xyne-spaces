import { Router, type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { DatabaseClient } from '@/database/client';
import { authMiddleware } from '@/middleware/auth';
import { vespaQueue } from '@/queues/vespaQueue';
import {
  ENTERPRISE_RAG_SOURCE_TYPES,
  getEnterpriseRagDocumentCounts,
  ingestEnterpriseRagDocument,
  type EnterpriseRagContext,
  type EnterpriseRagSourceType,
} from '@/services/enterpriseRagBenchmarkAdapter';
import { logger } from '@/utils/logger';

const router = Router();

export const isLoopbackRequest = (req: Request): boolean => {
  const address = req.ip || req.socket.remoteAddress || '';
  const isLoopback =
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1';
  return isLoopback;
};

export const usesLocalBenchmarkIdentity = (req: Request): boolean =>
  process.env.ENABLE_ENTERPRISE_RAG_BENCHMARK_ROUTES === 'true' &&
  process.env.ENABLE_ENTERPRISE_RAG_BENCHMARK_LOOPBACK === 'true' &&
  (isLoopbackRequest(req) || req.get('x-route-env') === 'onyx');

export const authenticateAdmin = [
  (req: Request, res: Response, next: NextFunction) => {
    if (usesLocalBenchmarkIdentity(req)) return next();
    return authMiddleware.authenticate(req, res, next);
  },
  (req: Request, res: Response, next: NextFunction) => {
    if (usesLocalBenchmarkIdentity(req)) return next();
    return authMiddleware.requireAdmin(req, res, next);
  },
];
export { authenticateAdmin as enterpriseRagAuthenticateAdmin };

const ingestSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  docId: z.string().trim().min(1).max(256),
  sourceType: z.enum(ENTERPRISE_RAG_SOURCE_TYPES),
  title: z.string().trim().min(1).max(20_000),
  content: z.string().trim().min(1).max(20_000_000),
}).strict();

export const resolveContext = async (req: Request): Promise<EnterpriseRagContext> => {
  if (usesLocalBenchmarkIdentity(req)) {
    const requestedWorkspaceId = req.get('x-workspace-id')?.trim();
    const requestedUserId = req.get('x-benchmark-user-id')?.trim();
    const database = DatabaseClient.getInstance();
    const requestedUser = requestedUserId
      ? await database.user.findUnique({
          where: { id: requestedUserId },
          include: { workspace: { select: { id: true, orgId: true } } },
        })
      : null;
    const user = requestedUser?.workspace.id === requestedWorkspaceId
      ? requestedUser
      : await database.user.findFirst({
          where: { leftAt: null, workspace: { status: 'ACTIVE' } },
          orderBy: { createdAt: 'asc' },
          include: { workspace: { select: { id: true, orgId: true } } },
        });
    if (user) {
      return {
        orgId: user.workspace.orgId,
        workspaceId: user.workspace.id,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
      };
    }

    // Development-only identity scaffolding. These are ordinary backend tenant
    // records required by the normal ingestion services; they are not Vespa docs.
    const workspaceId = requestedWorkspaceId || 'enterprise-rag-local';
    const userId = requestedUserId || `${workspaceId}-user`;
    const orgId = req.get('x-benchmark-org-id')?.trim() || `${workspaceId}-org`;
    const userName = req.get('x-user-name')?.trim() || 'EnterpriseRAG Local User';
    const userEmail = `enterprise-rag-${workspaceId.replace(/[^a-zA-Z0-9]/g, '-')}@localhost.invalid`;
    await database.organization.upsert({
      where: { orgId },
      update: {},
      create: {
        orgId,
        name: `EnterpriseRAG Local ${workspaceId}`,
        description: 'Local EnterpriseRAG-Bench development tenant',
        createdBy: userId,
      },
    });
    const orgMember = await database.orgMember.upsert({
      where: { email: userEmail },
      update: { orgId, leftAt: null },
      create: { orgId, email: userEmail, role: 'OWNER' },
    });
    await database.workspace.upsert({
      where: { id: workspaceId },
      update: {},
      create: {
        id: workspaceId,
        orgId,
        name: `EnterpriseRAG Local ${workspaceId}`,
        description: 'Local EnterpriseRAG-Bench workspace',
        createdBy: userId,
      },
    });
    await database.user.upsert({
      where: { id: userId },
      update: { name: userName, status: 'ACTIVE', leftAt: null },
      create: {
        id: userId,
        name: userName,
        email: userEmail,
        authProvider: 'EMAIL',
        providerUserId: `enterprise-rag:${userId}`,
        workspaceId,
        role: 'OWNER',
        orgMemberId: orgMember.memberId,
      },
    });
    return {
      orgId,
      workspaceId,
      userId,
      userName,
      userEmail,
    };
  }

  const user = req.user!;
  const workspace = await DatabaseClient.getInstance().workspace.findUnique({
    where: { id: user.workspaceId },
    select: { orgId: true },
  });
  if (!workspace) throw new Error(`Workspace ${user.workspaceId} was not found`);
  return {
    orgId: workspace.orgId,
    workspaceId: user.workspaceId,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
  };
};

router.post('/ingest', ...authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: 'Invalid EnterpriseRAG document',
      details: parsed.error.flatten(),
    });
    return;
  }

  try {
    const context = await resolveContext(req);
    const result = await ingestEnterpriseRagDocument(parsed.data, context);
    res.status(result.status === 'inserted' ? 202 : 200).json(result);
  } catch (error) {
    logger.error('[EnterpriseRAG] Failed to ingest document', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown ingestion error',
    });
  }
});

router.get('/stats', ...authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const context = await resolveContext(req);
    const counts = await getEnterpriseRagDocumentCounts(context.workspaceId);
    res.status(200).json({ success: true, ...counts });
  } catch (error) {
    logger.error('[EnterpriseRAG] Failed to read ingestion stats', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown stats error',
    });
  }
});

router.get('/queues', ...authenticateAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const queues = await vespaQueue.getAllStats();
    res.status(200).json({ success: true, queues });
  } catch (error) {
    logger.error('[EnterpriseRAG] Failed to read Vespa queue stats', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown queue stats error',
    });
  }
});

router.get('/context', ...authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const context = await resolveContext(req);
    res.status(200).json({ success: true, ...context });
  } catch (error) {
    logger.error('[EnterpriseRAG] Failed to resolve ingestion context', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown context error',
    });
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATASET_PATH = path.join(__dirname, '..', '..', 'src', 'dataset', 'documents.jsonl');
const DATASET_QUESTIONS_PATH = path.join(__dirname, '..', '..', 'src', 'dataset', 'questions.jsonl');

const ingestDatasetSchema = z.object({
  sourceType: z.enum(ENTERPRISE_RAG_SOURCE_TYPES).optional(),
  startRow: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(600_000).default(100),
  concurrency: z.number().int().min(1).max(8).default(2),
}).strict();

interface DatasetRow {
  doc_id: string;
  source_type: string;
  title: string;
  content: string;
}

async function* readDatasetRows(
  filePath: string,
  sourceTypeFilter?: string,
  startRow: number = 0,
  limit: number = 100,
): AsyncGenerator<{ row: DatasetRow; index: number }> {
  const { createReadStream } = await import('fs');
  const { createInterface } = await import('readline');
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let index = 0;
  let yielded = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (index < startRow) { index++; continue; }
    try {
      const row = JSON.parse(line) as DatasetRow;
      if (sourceTypeFilter && row.source_type !== sourceTypeFilter) { index++; continue; }
      yield { row, index };
      yielded++;
      if (yielded >= limit) break;
    } catch {
      logger.warn(`[EnterpriseRAG] Skipped invalid JSON at row ${index}`);
    }
    index++;
  }
}

router.post('/ingest-dataset', ...authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  const parsed = ingestDatasetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid ingest-dataset request', details: parsed.error.flatten() });
    return;
  }

  const fs = await import('fs');
  if (!fs.existsSync(DATASET_PATH)) {
    res.status(404).json({
      success: false,
      error: `Dataset file not found at ${DATASET_PATH}. Set ENTERPRISE_RAG_DATASET_PATH env var.`,
    });
    return;
  }

  try {
    const context = await resolveContext(req);
    const { sourceType, startRow, limit, concurrency } = parsed.data;
    const results: Array<{ docId: string; status: string; error?: string }> = [];
    const batch: Array<Promise<void>> = [];

    for await (const { row, index } of readDatasetRows(DATASET_PATH, sourceType, startRow, limit)) {
      const task = (async () => {
        try {
          const result = await ingestEnterpriseRagDocument({
            rowIndex: index,
            docId: row.doc_id,
            sourceType: row.source_type as EnterpriseRagSourceType,
            title: row.title,
            content: row.content,
          }, context);
          results.push({ docId: row.doc_id, status: result.status });
        } catch (err) {
          results.push({ docId: row.doc_id, status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' });
        }
      })();
      batch.push(task);
      if (batch.length >= concurrency) {
        await Promise.all(batch);
        batch.length = 0;
      }
    }
    if (batch.length > 0) await Promise.all(batch);

    const inserted = results.filter(r => r.status === 'inserted').length;
    const duplicates = results.filter(r => r.status === 'duplicate').length;
    const failed = results.filter(r => r.status === 'failed').length;

    res.status(200).json({
      success: true,
      processed: results.length,
      inserted,
      duplicates,
      failed,
      results,
    });
  } catch (error) {
    logger.error('[EnterpriseRAG] Dataset ingestion failed', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown ingestion error',
    });
  }
});

router.get('/dataset-info', ...authenticateAdmin, async (_req: Request, res: Response): Promise<void> => {
  const fs = await import('fs');
  const datasetExists = fs.existsSync(DATASET_PATH);
  const questionsExists = fs.existsSync(DATASET_QUESTIONS_PATH);
  let datasetRows = 0;
  if (datasetExists) {
    const { createReadStream } = await import('fs');
    const { createInterface } = await import('readline');
    const stream = createReadStream(DATASET_PATH, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (line.trim()) datasetRows++;
    }
  }
  res.status(200).json({
    success: true,
    datasetPath: DATASET_PATH,
    questionsPath: DATASET_QUESTIONS_PATH,
    datasetExists,
    questionsExists,
    datasetRows,
  });
});

// ---------------------------------------------------------------------------
// Background ingestion with /start, /stop, /resume controls
// ---------------------------------------------------------------------------
const BATCH_CONCURRENCY = 8;

let ingestionAbortFlag = false;
let ingestionContext: EnterpriseRagContext | null = null;

const ingestionProgress = {
  isRunning: false,
  totalRows: 0,
  processedRows: 0,
  inserted: 0,
  duplicates: 0,
  failed: 0,
  currentRow: 0,
  lastError: null as string | null,
  startedAt: null as Date | null,
  finishedAt: null as Date | null,
  stopped: false,
};

async function countDatasetRows(filePath: string): Promise<number> {
  const { createReadStream } = await import('fs');
  const { createInterface } = await import('readline');
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  for await (const line of rl) {
    if (line.trim()) count++;
  }
  return count;
}

async function resolveIngestionContext(): Promise<EnterpriseRagContext> {
  if (ingestionContext) return ingestionContext;
  const database = DatabaseClient.getInstance();
  const user = await database.user.findFirst({
    where: { leftAt: null, workspace: { status: 'ACTIVE' } },
    orderBy: { createdAt: 'asc' },
    include: { workspace: { select: { id: true, orgId: true } } },
  });
  if (!user) throw new Error('No active user found for ingestion');
  ingestionContext = {
    orgId: user.workspace.orgId,
    workspaceId: user.workspace.id,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
  };
  return ingestionContext;
}

async function runBackgroundIngestion(resumeFrom?: number): Promise<void> {
  if (ingestionProgress.isRunning) return;
  const fs = await import('fs');
  if (!fs.existsSync(DATASET_PATH)) {
    logger.error(`[EnterpriseRAG] Ingestion: dataset not found at ${DATASET_PATH}`);
    return;
  }

  const startRow = resumeFrom ?? ingestionProgress.currentRow ?? 0;

  ingestionProgress.isRunning = true;
  ingestionProgress.stopped = false;
  ingestionProgress.lastError = null;
  ingestionProgress.finishedAt = null;
  if (!resumeFrom && ingestionProgress.processedRows === 0) {
    ingestionProgress.startedAt = new Date();
    ingestionProgress.inserted = 0;
    ingestionProgress.duplicates = 0;
    ingestionProgress.failed = 0;
  } else {
    ingestionProgress.startedAt = ingestionProgress.startedAt ?? new Date();
  }

  try {
    if (!ingestionProgress.totalRows) {
      ingestionProgress.totalRows = await countDatasetRows(DATASET_PATH);
    }
    logger.info(`[EnterpriseRAG] Ingestion starting from row ${startRow}: ${ingestionProgress.totalRows} total rows`);

    let batch: Array<Promise<void>> = [];
    for await (const { row, index } of readDatasetRows(DATASET_PATH, undefined, startRow, ingestionProgress.totalRows)) {
      if (ingestionAbortFlag) {
        logger.info(`[EnterpriseRAG] Ingestion stopped at row ${index}`);
        break;
      }
      ingestionProgress.currentRow = index;
      const task = (async () => {
        try {
          const result = await ingestEnterpriseRagDocument({
            rowIndex: index,
            docId: row.doc_id,
            sourceType: row.source_type as EnterpriseRagSourceType,
            title: row.title,
            content: row.content,
          }, ingestionContext!);
          if (result.status === 'inserted') ingestionProgress.inserted++;
          else if (result.status === 'duplicate') ingestionProgress.duplicates++;
          else ingestionProgress.failed++;
        } catch (err) {
          ingestionProgress.failed++;
          ingestionProgress.lastError = err instanceof Error ? err.message : 'Unknown error';
        }
        ingestionProgress.processedRows++;
      })();
      batch.push(task);
      if (batch.length >= BATCH_CONCURRENCY) {
        await Promise.all(batch);
        batch.length = 0;
      }
    }
    if (batch.length > 0) await Promise.all(batch);

    if (ingestionAbortFlag) {
      ingestionProgress.stopped = true;
      logger.info(`[EnterpriseRAG] Ingestion stopped: ${ingestionProgress.processedRows}/${ingestionProgress.totalRows} processed, ${ingestionProgress.inserted} inserted, ${ingestionProgress.duplicates} duplicates, ${ingestionProgress.failed} failed`);
    } else {
      ingestionProgress.finishedAt = new Date();
      logger.info(`[EnterpriseRAG] Ingestion complete: ${ingestionProgress.processedRows}/${ingestionProgress.totalRows} processed, ${ingestionProgress.inserted} inserted, ${ingestionProgress.duplicates} duplicates, ${ingestionProgress.failed} failed`);
    }
  } catch (err) {
    ingestionProgress.lastError = err instanceof Error ? err.message : 'Unknown error';
    ingestionProgress.finishedAt = new Date();
    logger.error(`[EnterpriseRAG] Ingestion failed: ${ingestionProgress.lastError}`);
  } finally {
    ingestionAbortFlag = false;
    ingestionProgress.isRunning = false;
  }
}

router.post('/start', ...authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  if (ingestionProgress.isRunning) {
    res.status(409).json({ success: false, error: 'Ingestion already running. Use /stop first.' });
    return;
  }
  try {
    await resolveIngestionContext();
    const resumeFrom = req.body?.resumeFrom;
    runBackgroundIngestion(typeof resumeFrom === 'number' ? resumeFrom : undefined);
    res.status(202).json({ success: true, message: 'Ingestion started' });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.post('/stop', ...authenticateAdmin, async (_req: Request, res: Response): Promise<void> => {
  if (!ingestionProgress.isRunning) {
    res.status(409).json({ success: false, error: 'Ingestion not running', currentRow: ingestionProgress.currentRow });
    return;
  }
  ingestionAbortFlag = true;
  res.status(202).json({ success: true, message: 'Stop signal sent', currentRow: ingestionProgress.currentRow });
});

router.post('/resume', ...authenticateAdmin, async (_req: Request, res: Response): Promise<void> => {
  if (ingestionProgress.isRunning) {
    res.status(409).json({ success: false, error: 'Ingestion already running. Use /stop first.' });
    return;
  }
  try {
    await resolveIngestionContext();
    runBackgroundIngestion(ingestionProgress.currentRow + 1);
    res.status(202).json({ success: true, message: 'Ingestion resumed', fromRow: ingestionProgress.currentRow + 1 });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.get('/progress', ...authenticateAdmin, async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({
    success: true,
    ...ingestionProgress,
    startedAt: ingestionProgress.startedAt?.toISOString() ?? null,
    finishedAt: ingestionProgress.finishedAt?.toISOString() ?? null,
  });
});

if (process.env.ENTERPRISE_RAG_AUTO_INGEST === 'true' && process.env.ENABLE_ENTERPRISE_RAG_BENCHMARK_ROUTES === 'true') {
  logger.info('[EnterpriseRAG] Auto-ingest enabled, will start after server boots');
  setTimeout(async () => {
    try {
      await resolveIngestionContext();
      runBackgroundIngestion(0);
    } catch (err) {
      logger.error('[EnterpriseRAG] Auto-ingest startup failed', { error: err });
    }
  }, 10_000);
}

export default router;
