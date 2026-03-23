import Bull from 'bull';
import { logger } from '@/utils/logger';
import { conversationIngestQueue, type ConversationIngestJobData } from '@/queues/conversationIngestQueue';
import { conversationAnalysisService } from '@/services/conversationAnalysisService';
import { vespaKnowledgeIngestionService } from '@/services/vespaKnowledgeIngestionService';
import { createAdapter } from '@/services/conversationIngestion/adapterFactory';
import { SessionRecordingProcessStatus } from '@prisma/client';
import { db } from '@/database/client';

function extractSessionId(_source: string, sourceId: string): string | null {
  return sourceId || null;
}

async function updateSessionRecordingStatus(
  sessionId: string,
  status: SessionRecordingProcessStatus,
): Promise<void> {
  try {
    await db.sessionRecordingFile.update({
      where: { sessionId },
      data: { status },
    });
  } catch (err) {
    logger.warn(`[CONV-INGEST-WORKER] Could not update SessionRecordingFile status for sessionId=${sessionId}:`, err);
  }
}

class ConversationIngestionWorker {
  private isInitialized = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await conversationIngestQueue.initialize();

    const queue = conversationIngestQueue.getQueue();
    if (!queue) {
      throw new Error('[CONV-INGEST-WORKER] Queue not available after initialization');
    }

    queue.process('*', 10, async (job: Bull.Job<ConversationIngestJobData>) => {
      return this.processJob(job);
    });

    queue.on('failed', (job, _err) => {
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade >= maxAttempts) {
        const sessionId = extractSessionId(job.data.source, job.data.sourceId);
        if (sessionId) {
          updateSessionRecordingStatus(sessionId, SessionRecordingProcessStatus.FAILED);
        }
      }
    });

    this.isInitialized = true;
    logger.info('[CONV-INGEST-WORKER] Started, ready to process jobs');
  }

  private async processJob(job: Bull.Job<ConversationIngestJobData>): Promise<void> {
    const { gcsUri, source, sourceId } = job.data;
    logger.info(`[CONV-INGEST-WORKER] Processing job ${job.id} source=${source} sourceId=${sourceId} gcsUri=${gcsUri}`);

    const adapter = createAdapter(source, gcsUri, sourceId);
    const result = await conversationAnalysisService.analyse(adapter);
    await vespaKnowledgeIngestionService.ingestAll(adapter, result.sops, result.facts);

    // Mark session recording as COMPLETED for session sources
    const sessionId = extractSessionId(source, sourceId);
    if (sessionId) {
      await updateSessionRecordingStatus(sessionId, SessionRecordingProcessStatus.COMPLETED);
    }

    logger.info(`[CONV-INGEST-WORKER] Completed job ${job.id} source=${source} sourceId=${sourceId}`);
  }

  async shutdown(): Promise<void> {
    await conversationIngestQueue.close();
    this.isInitialized = false;
    logger.info('[CONV-INGEST-WORKER] Shut down');
  }
}

export const conversationIngestionWorker = new ConversationIngestionWorker();
