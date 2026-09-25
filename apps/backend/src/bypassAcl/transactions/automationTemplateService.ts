import { transaction } from '../base';

import { db } from '@/database/client';
import { storageService } from '@/services/storage';
import { AttachmentEntityType, AttachmentUploadStatus } from '@xyne/shared';
import { normalizeStoragePath } from '@xyne/storage';
import { Prisma } from '@prisma/client';
import { AutomationTemplateInputError, collectTemplateAttachmentIds } from '@/automations/services/automation-template.service';
import { AUTOMATION_WORKFLOW_TYPE } from '@/automations/types/workflow-adapter';


export function releaseAutomationTemplateTx(params: { attachmentId: string; workspaceId: string; }) {
  return transaction(['MessageAttachment', 'Workflow'], 'releaseAutomationTemplate: template attachment release and workflow reference check must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const record = await tx.messageAttachment.findFirst({
      where: {
        id: params.attachmentId,
        workspaceId: params.workspaceId,
        entityType: AttachmentEntityType.WORKFLOW_STEPS,
        isDeleted: false,
      },
    });
    const metadata = record?.metadata as { automationTemplate?: unknown } | null;
    if (!record || metadata?.automationTemplate !== true) return false;

    const locked = await tx.messageAttachment.updateMany({
      where: { id: record.id, workspaceId: params.workspaceId, isDeleted: false },
      data: { uploadStatus: AttachmentUploadStatus.COMPLETED },
    });
    if (locked.count === 0) return false;
    if (await isTemplateReferenced(tx, record.id, params.workspaceId)) return false;

    const otherOwners = await tx.messageAttachment.count({
      where: { id: { not: record.id }, url: record.url, isDeleted: false },
    });
    if (otherOwners === 0) {
      await storageService.deleteFile(normalizeStoragePath(record.url));
    }
    await tx.messageAttachment.delete({ where: { id: record.id } });
    return true;
  });
}

export async function claimAutomationTemplates(
  tx: Prisma.TransactionClient,
  configValue: unknown,
  workspaceId: string
): Promise<void> {
  const attachmentIds = [...collectTemplateAttachmentIds(configValue)];
  if (attachmentIds.length === 0) return;
  const result = await tx.messageAttachment.updateMany({
    where: {
      id: { in: attachmentIds },
      workspaceId,
      entityType: AttachmentEntityType.WORKFLOW_STEPS,
      isDeleted: false,
      metadata: { path: ['automationTemplate'], equals: true },
    },
    data: { uploadStatus: AttachmentUploadStatus.COMPLETED },
  });
  if (result.count !== attachmentIds.length) {
    throw new AutomationTemplateInputError(
      'One or more file templates are no longer available. Reattach them and try again.',
      409
    );
  }
}

export async function isTemplateReferenced(
  tx: Prisma.TransactionClient,
  attachmentId: string,
  workspaceId: string
): Promise<boolean> {
  const workflow = await tx.workflow.findFirst({
    where: {
      workspaceId,
      workflowType: AUTOMATION_WORKFLOW_TYPE,
      context: { contains: attachmentId },
    },
    select: { id: true },
  });
  return workflow !== null;
}
