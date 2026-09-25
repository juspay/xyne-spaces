import { db } from '@/database/client';
import { AttachmentEntityType, AttachmentUploadStatus } from '@xyne/shared';
import type { Prisma } from '@prisma/client';
import type { uploadFiles } from '@/services/fileUploadService';
import type { DeskReportGenerationService } from '@/services/deskReportGenerationService';
import { asService } from './base';

const DESK_REPORT_CALLBACK_REASON =
  'desk report callback: unauthenticated callback has no session, scope opened off the channel\'s workspaceId';

/**
 * Relocated from controllers/deskReportCallback.handler.ts. Unauthenticated callback — no HTTP
 * session to derive the tenant from, so scope is opened explicitly off the channel's workspaceId.
 * Matches the pending report row by the exact id embedded in the callback URL at dispatch time.
 */
export function findPendingDeskReportAttachment(workspaceId: string, channelId: string, attachmentId: string) {
  return asService(
    ['MessageAttachment'],
    DESK_REPORT_CALLBACK_REASON,
    'desk-report-callback',
    workspaceId,
    () =>
      db.messageAttachment.findFirst({
        where: {
          id: attachmentId,
          entityType: AttachmentEntityType.DESK_REPORT,
          entityId: channelId,
          isDeleted: false,
          uploadStatus: AttachmentUploadStatus.PENDING,
        },
      }),
  );
}

/**
 * Relocated from controllers/deskReportCallback.handler.ts. The callback reported an error or
 * carried no report, so the pending row is marked failed.
 */
export function markDeskReportAttachmentFailed(
  workspaceId: string,
  attachmentId: string,
  metadata: Record<string, unknown>,
  errorMessage: string | undefined,
) {
  return asService(
    ['MessageAttachment'],
    DESK_REPORT_CALLBACK_REASON,
    'desk-report-callback',
    workspaceId,
    () =>
      db.messageAttachment.update({
        where: { id: attachmentId },
        data: {
          uploadStatus: AttachmentUploadStatus.FAILED,
          metadata: { ...metadata, error: errorMessage ?? 'No report produced' } as Prisma.InputJsonValue,
        },
      }),
  );
}

/**
 * Relocated from controllers/deskReportCallback.handler.ts. The report was uploaded, so the
 * pending row is completed with the stored file's details.
 */
export function completeDeskReportAttachment(
  workspaceId: string,
  attachmentId: string,
  uploaded: Awaited<ReturnType<typeof uploadFiles>>[number],
  metadata: Record<string, unknown>,
) {
  return asService(
    ['MessageAttachment'],
    DESK_REPORT_CALLBACK_REASON,
    'desk-report-callback',
    workspaceId,
    () =>
      db.messageAttachment.update({
        where: { id: attachmentId },
        data: {
          originalFilename: uploaded.originalName,
          size: uploaded.fileSize,
          mimetype: uploaded.mimeType,
          url: uploaded.fileUrl,
          uploadStatus: AttachmentUploadStatus.COMPLETED,
          metadata: { ...metadata, generatedAt: new Date().toISOString() } as Prisma.InputJsonValue,
        },
      }),
  );
}

/**
 * Relocated from services/deskReportGenerationService.ts's runScheduledGeneration. Cron-scheduled
 * generation across every workspace's preferences — no request context, so each channel's report
 * needs its own scope opened from that channel's workspaceId.
 */
export function generateScheduledDeskReport(
  service: DeskReportGenerationService,
  pref: Parameters<DeskReportGenerationService['generateReportForChannel']>[0],
): ReturnType<DeskReportGenerationService['generateReportForChannel']> {
  return asService(
    ['MessageAttachment'],
    'desk report scheduler: cron job has no request context, scope opened per channel\'s own workspaceId',
    'desk-report-scheduler',
    pref.workspaceId,
    () => service.generateReportForChannel(pref),
  );
}
