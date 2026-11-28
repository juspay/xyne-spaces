import { api } from '@xyne/shared';
import { appPermission } from '@/apps/access';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';
import { ContractError, controller } from '@/framework/api';
import { assertAttachmentAccess } from '@/services/attachmentAccessService';
import { internal, requireUser } from '../../settings.helpers';

// ─── A file's metadata (Xyne Apps, bot token) ───────────────────────────────

const messageAttachmentRepository = new MessageAttachmentRepository();

/** GET /apps/files/info/:attachmentId */
export const fileInfo = controller(api.apps.files.info, { checks: { permission: appPermission('files:read') } }, async (input) => {
  try {
    const user = requireUser(input.user);
    const attachment = await messageAttachmentRepository.findById(input.params.attachmentId);
    if (!attachment) throw new ContractError(404, { error: 'Attachment not found', code: 'NOT_FOUND' });
    const access = await assertAttachmentAccess(attachment, user.id, user.workspaceId);
    if (!access.ok) throw new ContractError(access.status, access.body as { error: string });
    return {
      id: attachment.id,
      originalFilename: attachment.originalFilename,
      mimetype: attachment.mimetype,
      size: attachment.size,
      width: attachment.width,
      height: attachment.height,
      thumbnailUrl: attachment.thumbnailUrl,
      createdAt: attachment.createdAt,
      conversationId: attachment.conversationId,
    };
  } catch (error) {
    throw internal(error, 'Error fetching file info:');
  }
});