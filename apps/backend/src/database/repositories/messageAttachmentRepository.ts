import { DatabaseClient } from '../client';
import { MessageAttachment } from '@prisma/client';
import { AttachmentEntityType } from '@xyne/shared';

export interface CreateMessageAttachmentInput {
  entityId: string; // Message ID or Ticket ID
  entityType: AttachmentEntityType; // CHAT or TICKET
  originalFilename: string;
  size: number;
  mimetype: string;
  url: string;
  thumbnailUrl?: string;
  width?: number; // Width in pixels (for images/videos)
  height?: number; // Height in pixels (for images/videos)
  uploadedByUserId: string;
  createdBy: string;
  storageProvider: string;
  conversationId: string | null;
  workspaceId: string;
  metadata?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  createdAt?: Date;
  uploadStatus?: string;
}

export class MessageAttachmentRepository {
  private db = DatabaseClient.getInstance();

  async create(data: CreateMessageAttachmentInput): Promise<MessageAttachment> {
    const attachment = await this.db.messageAttachment.create({
      data: {
        entityId: data.entityId,
        entityType: data.entityType,
        originalFilename: data.originalFilename,
        size: data.size,
        mimetype: data.mimetype,
        url: data.url,
        thumbnailUrl: data.thumbnailUrl,
        width: data.width,
        height: data.height,
        uploadedByUserId: data.uploadedByUserId,
        createdBy: data.createdBy,
        storageProvider: data.storageProvider,
        conversationId: data.conversationId,
        workspaceId: data.workspaceId,
        metadata: data.metadata || {},
        ...(data.uploadStatus && { uploadStatus: data.uploadStatus }),
        ...(data.createdAt && { createdAt: data.createdAt })
      }
    });

    return attachment;
  }

  async findById(id: string): Promise<MessageAttachment | null> {
    return await this.db.messageAttachment.findUnique({
      where: { id }
    });
  }

  async findByIds(ids: string[]): Promise<MessageAttachment[]> {
    if (ids.length === 0) {
      return [];
    }
    return await this.db.messageAttachment.findMany({
      where: {
        id: {
          in: ids
        }
      }
    });
  }

  async findByMessageId(messageId: string): Promise<MessageAttachment[]> {
    return await this.db.messageAttachment.findMany({
      where: {
        entityId: messageId,
        entityType: AttachmentEntityType.CHAT
      },
      orderBy: { createdAt: 'asc' }
    });
  }

  async findByMessageIds(messageIds: string[]): Promise<MessageAttachment[]> {
    if (messageIds.length === 0) {
      return [];
    }
    return await this.db.messageAttachment.findMany({
      where: {
        entityId: {
          in: messageIds,
        },
        entityType: AttachmentEntityType.CHAT,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByEmailIds(emailIds: string[]): Promise<MessageAttachment[]> {
    if (emailIds.length === 0) {
      return [];
    }

    return await this.db.messageAttachment.findMany({
      where: {
        entityId: {
          in: emailIds,
        },
        entityType: AttachmentEntityType.EMAIL,
        isDeleted: false,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findTranscriptByMessageId(messageId: string): Promise<MessageAttachment | null> {
    return await this.db.messageAttachment.findFirst({
      where: {
        entityId: messageId,
        entityType: AttachmentEntityType.CHAT,
        metadata: {
          path: ['type'],
          equals: 'transcript'
        }
      }
    });
  }

  async findTranscriptByCallId(callId: string): Promise<MessageAttachment | null> {
    return await this.db.messageAttachment.findFirst({
      where: {
        entityType: AttachmentEntityType.CHAT,
        AND: [
          {
            metadata: {
              path: ['type'],
              equals: 'transcript',
            },
          },
          {
            metadata: {
              path: ['callId'],
              equals: callId,
            },
          },
        ],
      },
      orderBy: {
        createdAt: 'desc', // Get the most recent one
      },
    });
  }

  async findIdentifiedTranscriptByCallId(callId: string): Promise<MessageAttachment | null> {
    return await this.db.messageAttachment.findFirst({
      where: {
        entityType: AttachmentEntityType.CHAT,
        AND: [
          {
            metadata: {
              path: ['type'],
              equals: 'identified_transcript',
            },
          },
          {
            metadata: {
              path: ['callId'],
              equals: callId,
            },
          },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async createMany(attachments: CreateMessageAttachmentInput[]): Promise<void> {
    await this.db.messageAttachment.createMany({
      data: attachments
    });

  }

  async deleteByMessageId(messageId: string): Promise<void> {
    await this.db.messageAttachment.deleteMany({
      where: {
        entityId: messageId,
        entityType: AttachmentEntityType.CHAT
      }
    });
  }

  async findByTicketId(ticketId: string): Promise<MessageAttachment[]> {
    return await this.db.messageAttachment.findMany({
      where: {
        entityId: ticketId,
        entityType: AttachmentEntityType.TICKET
      },
      orderBy: { createdAt: 'asc' }
    });
  }

  async updateManyEntityTypeAndId(attachmentIds: string[], entityType: AttachmentEntityType, entityId: string): Promise<void> {
    await this.db.messageAttachment.updateMany({
      where: {
        id: {
          in: attachmentIds
        }
      },
      data: {
        entityType,
        entityId,
      }
    });
  }

  async findByCallId(callId: string): Promise<MessageAttachment[]> {
    return await this.db.messageAttachment.findMany({
      where: {
        metadata: {
          path: ['callId'],
          equals: callId,
        },
      },
    });
  }

  async findRecordingByCallId(callId: string): Promise<MessageAttachment | null> {
    return await this.db.messageAttachment.findFirst({
      where: {
        AND: [
          { metadata: { path: ['callId'], equals: callId } },
          { metadata: { path: ['type'], equals: 'recording' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findWhiteboardByCallId(callId: string): Promise<MessageAttachment | null> {
    return await this.db.messageAttachment.findFirst({
      where: {
        AND: [
          { metadata: { path: ['callId'], equals: callId } },
          { metadata: { path: ['type'], equals: 'whiteboard' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findWhiteboardByCallIdAndPageId(
    callId: string,
    pageId: string,
  ): Promise<MessageAttachment | null> {
    return await this.db.messageAttachment.findFirst({
      where: {
        AND: [
          { metadata: { path: ['callId'], equals: callId } },
          { metadata: { path: ['pageId'], equals: pageId } },
          { metadata: { path: ['type'], equals: 'whiteboard' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByConversationId(conversationId: string): Promise<MessageAttachment[]> {
    return await this.db.messageAttachment.findMany({
      where: { conversationId, isDeleted: false },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByEntityIdAndType(entityId: string, entityType: AttachmentEntityType): Promise<MessageAttachment[]> {
    return await this.db.messageAttachment.findMany({
      where: {
        entityId,
        entityType
      },
      orderBy: { createdAt: 'asc' }
    });
  }

  async hasEmailAttachment(emailId: string): Promise<boolean> {
    const attachment = await this.db.messageAttachment.findFirst({
      where: {
        entityId: emailId,
        entityType: AttachmentEntityType.EMAIL,
        isDeleted: false,
      },
      select: { id: true },
    });
    return attachment !== null;
  }

  async updateVersion(id: string, metadata: Record<string, any>): Promise<MessageAttachment> { // eslint-disable-line @typescript-eslint/no-explicit-any
    // Increment version in metadata
    const currentVersion = (metadata.version as number) || 0;

    return await this.db.messageAttachment.update({
      where: { id },
      data: {
        metadata: {
          ...metadata,
          version: currentVersion + 1
        }
      },
    });
  }

  async update(id: string, data: Partial<CreateMessageAttachmentInput>): Promise<MessageAttachment> {
    return await this.db.messageAttachment.update({
      where: { id },
      data: {
        ...(data.url && { url: data.url }),
        ...(data.size !== undefined && { size: data.size }),
        ...(data.metadata && { metadata: data.metadata }),
        ...(data.originalFilename && { originalFilename: data.originalFilename }),
        ...(data.mimetype && { mimetype: data.mimetype }),
        ...(data.thumbnailUrl && { thumbnailUrl: data.thumbnailUrl }),
        ...(data.width && { width: data.width }),
        ...(data.height && { height: data.height }),
      }
    });
  }

}
