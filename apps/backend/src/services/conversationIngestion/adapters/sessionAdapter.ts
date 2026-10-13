import { DatabaseClient } from '@/database/client';
import { resolveMemoryWorkspaceId } from '@/services/memoryService';
import { BaseGcsAdapter } from './baseGcsAdapter';
import type { MemoryIngestionContext } from '../types';

/**
 * Expected shape of the xyne-cli / claude session JSON stored in GCS:
 * {
 *   messages: [...],    // conversation turns
 *   repoUrl: string,
 *   commitId: string,
 *   ticketId: string,
 *   userId: string,     // optional
 *   [key: string]: any  // other top-level metadata
 * }
 */
interface SessionPayload {
  messages: unknown[];
  repoUrl?: string;
  commitId?: string;
  ticketId?: string;
  userId?: string;
  [key: string]: unknown;
}

export class SessionAdapter extends BaseGcsAdapter {
  constructor(gcsUri: string, sourceId: string) {
    super(gcsUri, sourceId);
    // sourceId IS the sessionId — no parsing needed.
    // userId and other metadata are read directly from the GCS payload.
    if (!sourceId) {
      throw new Error(`[SessionAdapter] sourceId (sessionId) must not be empty`);
    }
  }

  /**
   * Override: return the messages array from the session payload.
   */
  override async getItems(): Promise<unknown[]> {
    const payload = await this.getRawPayload() as SessionPayload;
    if (!Array.isArray(payload.messages)) {
      throw new Error(
        `[SessionAdapter] Expected payload.messages to be an array in ${this.gcsUri}`,
      );
    }
    return payload.messages;
  }

  async buildMemoryContext(): Promise<MemoryIngestionContext> {
    const payload = await this.getRawPayload() as SessionPayload;
    const prisma = DatabaseClient.getInstance();
    const recording = await (prisma as any).sessionRecordingFile.findUnique({
      where: { sessionId: this.sourceId },
      select: { workspaceId: true },
    });
    const workspaceId: string =
      recording?.workspaceId ?? (await resolveMemoryWorkspaceId(payload.userId ?? ''));
    return {
      sessionId: this.sourceId,
      userId: payload.userId ?? '',
      workspaceId,
      repoUrl: payload.repoUrl ?? '',
      commitId: payload.commitId ?? '',
      ticketId: payload.ticketId ?? '',
      fileStoragePath: this.gcsUri,
    };
  }
}
