import { prisma } from "../db.js";

export interface CreateChatAttachmentInput {
  uploaderUserId: string;
  url: string;
  thumbnailUrl?: string | null;
  originalFilename: string;
  mimeType: string;
  size: number;
  width?: number | null;
  height?: number | null;
  metadata?: Record<string, unknown> | null;
}

export const chatAttachmentRepository = {
  create: (data: CreateChatAttachmentInput) =>
    prisma.chatAttachment.create({
      data: {
        uploaderUserId: data.uploaderUserId,
        url: data.url,
        thumbnailUrl: data.thumbnailUrl ?? null,
        originalFilename: data.originalFilename,
        mimeType: data.mimeType,
        size: data.size,
        width: data.width ?? null,
        height: data.height ?? null,
        ...(data.metadata ? { metadata: data.metadata as never } : {}),
      },
    }),

  findById: (id: string) => prisma.chatAttachment.findUnique({ where: { id } }),

  linkToMessage: (attachmentIds: string[], chatMessageId: string, uploaderUserId: string) =>
    prisma.chatAttachment.updateMany({
      where: {
        id: { in: attachmentIds },
        uploaderUserId,
        chatMessageId: null,
      },
      data: { chatMessageId },
    }),

  findManyByIdsForUser: (attachmentIds: string[], uploaderUserId: string) =>
    prisma.chatAttachment.findMany({
      where: { id: { in: attachmentIds }, uploaderUserId },
    }),
};
