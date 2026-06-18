import { redisService } from '@/services/redisService';

const TTL_SECONDS = 60 * 60 * 24 * 7;

export interface WhatsAppBulkStagedFile {
  stagedFileId: string;
  workspaceId: string;
  uploaderUserId: string;
  originalName: string;
  gcsPath: string;
  size: number;
  uploadedAt: string;
  consumedAt: string | null;
}

class WhatsAppBulkMigrationStageService {
  private buildKey(stagedFileId: string): string {
    return `whatsapp:bulk:staged:${stagedFileId}`;
  }

  async create(input: Omit<WhatsAppBulkStagedFile, 'uploadedAt' | 'consumedAt'>): Promise<WhatsAppBulkStagedFile> {
    const stagedFile: WhatsAppBulkStagedFile = {
      ...input,
      uploadedAt: new Date().toISOString(),
      consumedAt: null,
    };

    await redisService
      .getClient()
      .set(this.buildKey(input.stagedFileId), JSON.stringify(stagedFile), 'EX', TTL_SECONDS);

    return stagedFile;
  }

  async get(stagedFileId: string): Promise<WhatsAppBulkStagedFile | null> {
    const raw = await redisService.getClient().get(this.buildKey(stagedFileId));
    if (!raw) return null;

    try {
      return JSON.parse(raw) as WhatsAppBulkStagedFile;
    } catch {
      return null;
    }
  }

  async markConsumed(stagedFileId: string): Promise<WhatsAppBulkStagedFile | null> {
    const current = await this.get(stagedFileId);
    if (!current) return null;

    const next: WhatsAppBulkStagedFile = {
      ...current,
      consumedAt: new Date().toISOString(),
    };

    await redisService
      .getClient()
      .set(this.buildKey(stagedFileId), JSON.stringify(next), 'EX', TTL_SECONDS);

    return next;
  }
}

export const whatsAppBulkMigrationStageService = new WhatsAppBulkMigrationStageService();
