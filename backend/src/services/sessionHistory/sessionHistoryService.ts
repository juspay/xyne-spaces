import { getStorageService } from '@/services/storage';
import { logger } from '@/utils/logger';
import { type NormalizedContext, transformXyneCli, transformWorkflow } from './transformers';

export type { AgentType, MessageKind, NormalizedContext, NormalizedMessage } from './transformers';
export { transformWorkflow } from './transformers';

const BUCKET_TRANSFORMERS: Record<string, (rawPayload: unknown) => NormalizedContext> = {
  'xyne-session-recordings': transformXyneCli,
  'xyne-workflow-steps':     transformWorkflow,
};

function parseGcsUri(url: string): { bucketName: string; filePath: string } {
  const match = url.match(/^gs:\/\/(?<bucketName>[^/]+)\/(?<filePath>.+)$/);
  const bucketName = match?.groups?.bucketName;
  const filePath = match?.groups?.filePath;

  if (!bucketName || !filePath) {
    throw new Error(`[SessionHistory] Invalid GCS URI: "${url}"`);
  }

  return { bucketName, filePath };
}

class SessionHistoryService {
  async extractSessionHistory(url: string): Promise<NormalizedContext> {
    logger.info(`[SessionHistory] url=${url}`);

    const { bucketName, filePath } = parseGcsUri(url);

    const transform = BUCKET_TRANSFORMERS[bucketName];
    if (!transform) throw new Error(`[SessionHistory] Unknown bucket: "${bucketName}"`);

    const buffer = await getStorageService(bucketName).getFileBuffer(filePath);
    return transform(JSON.parse(buffer.toString('utf-8')));
  }
}

export const sessionHistoryService = new SessionHistoryService();
