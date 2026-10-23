import { prisma } from "../db.js";

export interface CreateChatAttachmentInput {
  chatMessageId?: string | null;
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
        chatMessageId: data.chatMessageId ?? null,
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

  /** Uploader-scoped like findOwnedById: an id the caller did not upload is
   *  absent from the map rather than an error. */
  originalFilenamesByIds: async (
    attachmentIds: string[],
    uploaderUserIds: string | string[],
  ): Promise<Map<string, string>> => {
    if (attachmentIds.length === 0) return new Map();
    const rows = await prisma.chatAttachment.findMany({
      where: {
        id: { in: attachmentIds },
        ...(Array.isArray(uploaderUserIds)
          ? { uploaderUserId: { in: uploaderUserIds } }
          : { uploaderUserId: uploaderUserIds }),
      },
      select: { id: true, originalFilename: true },
    });
    return new Map(rows.map((row) => [row.id, row.originalFilename]));
  },

  /**
   * One attachment the caller uploaded, matched across every id they are
   * verified under. Null when it does not exist or belongs to someone else, so
   * a caller cannot tell the two apart.
   *
   * Alias-aware, unlike findManyByIdsForUser: an attachment uploaded under the
   * caller's raw Spaces id is still theirs, and matching one id would answer
   * "not found" for their own file.
   */
  findOwnedById: (id: string, uploaderUserIds: string | string[]) =>
    prisma.chatAttachment.findFirst({
      where: {
        id,
        ...(Array.isArray(uploaderUserIds)
          ? { uploaderUserId: { in: uploaderUserIds } }
          : { uploaderUserId: uploaderUserIds }),
      },
    }),
};
