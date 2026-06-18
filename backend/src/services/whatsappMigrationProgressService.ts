import { redisService } from '@/services/redisService';

export type WhatsAppMigrationJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface WhatsAppMigrationJobProgress {
  jobId: string;
  status: WhatsAppMigrationJobStatus;
  targetChannelId: string;
  chatName: string | null;
  phase:
    | 'queued'
    | 'parsing'
    | 'resolving_users'
    | 'importing_messages'
    | 'importing_media'
    | 'indexing'
    | 'completed'
    | 'failed';
  totalMessages: number | null;
  importedMessages: number;
  totalMedia: number | null;
  importedMedia: number;
  unresolvedNames: string[];
  warnings: string[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  errorMessage?: string;
  result?: {
    externalSourceId: string;
    externalSourceCreated: boolean;
    importedMessages: number;
    importedMedia: number;
    skippedMessages: number;
    unmatchedMediaRefs: string[];
  };
}

const TTL_SECONDS = 60 * 60 * 24 * 7;

class WhatsAppMigrationProgressService {
  private buildKey(jobId: string): string {
    return `whatsapp:migration:job:${jobId}`;
  }

  async createJob(
    jobId: string,
    input: { targetChannelId: string; chatName?: string | null },
  ): Promise<WhatsAppMigrationJobProgress> {
    const now = new Date().toISOString();
    const progress: WhatsAppMigrationJobProgress = {
      jobId,
      status: 'queued',
      targetChannelId: input.targetChannelId,
      chatName: input.chatName ?? null,
      phase: 'queued',
      totalMessages: null,
      importedMessages: 0,
      totalMedia: null,
      importedMedia: 0,
      unresolvedNames: [],
      warnings: [],
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    };

    await this.setProgress(progress);
    return progress;
  }

  async getJob(jobId: string): Promise<WhatsAppMigrationJobProgress | null> {
    const data = await redisService.getClient().get(this.buildKey(jobId));
    if (!data) return null;
    try {
      return JSON.parse(data) as WhatsAppMigrationJobProgress;
    } catch {
      return null;
    }
  }

  async setProgress(progress: WhatsAppMigrationJobProgress): Promise<void> {
    const next = {
      ...progress,
      updatedAt: new Date().toISOString(),
    };

    await redisService.getClient().set(this.buildKey(progress.jobId), JSON.stringify(next), 'EX', TTL_SECONDS);
  }

  async patchJob(
    jobId: string,
    patch: Partial<WhatsAppMigrationJobProgress>,
  ): Promise<WhatsAppMigrationJobProgress | null> {
    const client = redisService.getClient();
    const key = this.buildKey(jobId);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await client.watch(key);
      const currentRaw = await client.get(key);
      if (!currentRaw) {
        await client.unwatch();
        return null;
      }

      let current: WhatsAppMigrationJobProgress;
      try {
        current = JSON.parse(currentRaw) as WhatsAppMigrationJobProgress;
      } catch {
        await client.unwatch();
        return null;
      }

      const next: WhatsAppMigrationJobProgress = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      };

      const result = await client
        .multi()
        .set(key, JSON.stringify(next), 'EX', TTL_SECONDS)
        .exec();

      if (result) {
        return next;
      }
    }

    throw new Error(`Failed to patch WhatsApp migration job ${jobId} after retries`);
  }
}

export const whatsAppMigrationProgressService = new WhatsAppMigrationProgressService();
