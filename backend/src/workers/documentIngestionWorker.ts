import Bull from 'bull';
import { logger } from '@/utils/logger';
import { documentIngestQueue, type DocumentIngestJobData } from '@/queues/documentIngestQueue';
import { documentAnalysisService } from '@/services/documentAnalysisService';
import { vespaKnowledgeIngestionService, type ReplaceSessionDoc } from '@/services/vespaKnowledgeIngestionService';
import { getStorageService } from '@/services/storage';
import { config } from '@/config/env';

class DocumentIngestionWorker {
  private isInitialized = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await documentIngestQueue.initialize();

    const queue = documentIngestQueue.getQueue();
    if (!queue) {
      throw new Error('[DOC-INGEST-WORKER] Queue not available after initialization');
    }

    queue.process('*', 5, async (job: Bull.Job<DocumentIngestJobData>) => {
      return this.processJob(job);
    });

    queue.on('failed', (job, err) => {
      logger.error(
        `[DOC-INGEST-WORKER] Job ${job.id} permanently failed after ${job.attemptsMade} attempts ` +
        `sessionId=${job.data.sessionId} file=${job.data.originalFilename}:`,
        err,
      );
    });

    this.isInitialized = true;
    logger.info('[DOC-INGEST-WORKER] Started, ready to process jobs');
  }

  private async processJob(job: Bull.Job<DocumentIngestJobData>): Promise<void> {
    const { gcsUri, userId, sessionId, originalFilename } = job.data;
    logger.info(`[DOC-INGEST-WORKER] Processing job ${job.id} sessionId=${sessionId} file=${originalFilename}`);

    // 1. Parse bucket + path from the GCS URI
    const match = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      throw new Error(`[DOC-INGEST-WORKER] Invalid GCS URI: ${gcsUri}`);
    }
    const [, bucketName, filePath] = match;

    // 2. Download file from GCS
    const storage = getStorageService(bucketName || config.gcs.docsBucketName);
    const buffer = await storage.getFileBuffer(filePath);
    const content = buffer.toString('utf-8');

    logger.info(`[DOC-INGEST-WORKER] Downloaded file=${originalFilename} size=${buffer.length} bytes`);

    // 3. Run analysis — single agent.execute() call with full file content
    const result = await documentAnalysisService.analyseDocument(content, originalFilename, userId, sessionId);

    // 4. Map analysis result to ReplaceSessionDoc format
    const docs: ReplaceSessionDoc[] = [
      ...result.sops.map((sop): ReplaceSessionDoc => ({
        docType: 'sop',
        rawContent: sop.content,
        userQuery: sop.userQuery,
        tags: sop.tags,
        filePointers: sop.filePointers,
        repoUrl: sop.repoUrl || job.data.repoUrl,
        commitId: sop.commitId ?? '',
        ticketId: sop.ticketId ?? '',
        reviewStatus: 'pending',
      })),
      ...result.facts.map((fact): ReplaceSessionDoc => ({
        docType: 'fact',
        rawContent: fact.content,
        userQuery: fact.userQuery,
        tags: fact.tags,
        filePointers: fact.filePointers,
        repoUrl: fact.repoUrl || job.data.repoUrl,
        commitId: fact.commitId ?? '',
        ticketId: fact.ticketId ?? '',
        reviewStatus: 'pending',
      })),
    ];

    // 5. Atomically replace all docs for this session in Vespa
    await vespaKnowledgeIngestionService.replaceSession(sessionId, userId, docs);

    logger.info(
      `[DOC-INGEST-WORKER] Completed job ${job.id} sessionId=${sessionId} file=${originalFilename} ` +
      `sops=${result.sops.length} facts=${result.facts.length}`,
    );
  }

  async shutdown(): Promise<void> {
    await documentIngestQueue.close();
    this.isInitialized = false;
    logger.info('[DOC-INGEST-WORKER] Shut down');
  }
}

export const documentIngestionWorker = new DocumentIngestionWorker();
