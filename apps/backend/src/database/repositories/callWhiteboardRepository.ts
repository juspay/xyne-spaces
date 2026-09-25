import { saveCallWhiteboardAttachmentTx } from '@/bypassAcl/transactions/callWhiteboardRepository';
import { DatabaseClient } from '../client';
import { MessageAttachment } from '@prisma/client';

export interface SaveCallWhiteboardAttachmentInput {
  callId: string;
  conversationId: string;
  workspaceId: string;
  callMessageId: string;
  botUserId: string;
  savedByUserId: string;
  originalFilename: string;
  size: number;
  url: string;
  storageProvider: string;
  pageId?: string;
  pageLabel?: string;
  pageOrder?: number;
  width?: number;
  height?: number;
}

export interface SaveCallWhiteboardAttachmentResult {
  attachment: MessageAttachment;
  alreadyExists: boolean;
  whiteboardMessageId: string;
}

export class CallWhiteboardRepository {
  get db() {
    return DatabaseClient.getInstance();
  }

  async saveCallWhiteboardAttachment(
    data: SaveCallWhiteboardAttachmentInput,
  ): Promise<SaveCallWhiteboardAttachmentResult> {
    const lockKey = `whiteboard:${data.callId}:${data.pageId ?? 'call'}`;

    return await saveCallWhiteboardAttachmentTx(this, lockKey, data);
  }
}

