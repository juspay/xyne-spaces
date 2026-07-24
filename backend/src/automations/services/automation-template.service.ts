import { Readable } from 'node:stream';
import { AttachmentEntityType, AttachmentUploadStatus, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/database/client';
import { config } from '@/config/env';
import type { UploadedFileResult } from '@/services/fileUploadService';
import { storageService } from '@/services/storage';
import { normalizeStoragePath } from '@/services/storage/pathUtils';
import { logger } from '@/utils/logger';
import type { AutomationContext } from '../types/context';
import { AUTOMATION_WORKFLOW_TYPE } from '../types/workflow-adapter';
import { resolveAutomationPath } from '../engine/variable-resolver';
import { tokenize } from '../util/variable-ref';

export const AUTOMATION_TEMPLATE_MAX_FILES = 10;
export const AUTOMATION_TEMPLATE_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const AUTOMATION_TEMPLATE_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const AUTOMATION_TEMPLATE_GC_GRACE_MS = 24 * 60 * 60 * 1000;
const AUTOMATION_TEMPLATE_GC_BATCH_SIZE = 100;

const TEMPLATE_TYPES = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
} as const;

export const AutomationTemplateAttachmentSchema = z.object({
  attachmentId: z.string().min(1),
  originalFilename: z.string().min(1),
  mimetype: z.enum(['text/plain', 'text/markdown', 'text/html']),
  size: z.number().int().nonnegative().max(AUTOMATION_TEMPLATE_MAX_FILE_BYTES),
  templatePaths: z.array(z.string().min(1)),
});

export type AutomationTemplateAttachment = z.infer<typeof AutomationTemplateAttachmentSchema>;

export class AutomationTemplateInputError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 409 | 413 = 400
  ) {
    super(message);
    this.name = 'AutomationTemplateInputError';
  }
}

interface StoredTemplate {
  descriptor: AutomationTemplateAttachment;
  content: string;
}

export interface PreparedAutomationTemplateFile {
  originalName: string;
  mimeType: AutomationTemplateAttachment['mimetype'];
  sourceAttachmentId: string;
  buffer: Buffer;
}

function extensionOf(filename: string): keyof typeof TEMPLATE_TYPES | null {
  const dot = filename.lastIndexOf('.');
  const extension = dot > 0 ? filename.slice(dot).toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(TEMPLATE_TYPES, extension)
    ? (extension as keyof typeof TEMPLATE_TYPES)
    : null;
}

function decodeUtf8(buffer: Buffer, filename: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new AutomationTemplateInputError(`${filename} must contain valid UTF-8 text`);
  }
}

export function extractTemplatePaths(content: string): string[] {
  return Array.from(
    new Set(
      tokenize(content)
        .filter(
          (token): token is Extract<ReturnType<typeof tokenize>[number], { kind: 'ref' }> =>
            token.kind === 'ref'
        )
        .map((token) => token.path)
    )
  );
}

function samePaths(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((path) => rightSet.has(path));
}

async function removeUploadedPaths(files: Express.Multer.File[]): Promise<void> {
  await Promise.allSettled(
    files.map((file) =>
      file.path ? storageService.deleteFile(normalizeStoragePath(file.path)) : Promise.resolve()
    )
  );
}

export async function storeAutomationTemplates(params: {
  files: Express.Multer.File[];
  stepId: string;
  userId: string;
  workspaceId: string;
}): Promise<AutomationTemplateAttachment[]> {
  const { files, stepId, userId, workspaceId } = params;
  try {
    if (!stepId.trim()) throw new AutomationTemplateInputError('stepId is required');
    if (files.length === 0) throw new AutomationTemplateInputError('At least one file is required');
    if (files.length > AUTOMATION_TEMPLATE_MAX_FILES) {
      throw new AutomationTemplateInputError(
        `Maximum ${AUTOMATION_TEMPLATE_MAX_FILES} files allowed`,
        413
      );
    }
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > AUTOMATION_TEMPLATE_MAX_TOTAL_BYTES) {
      throw new AutomationTemplateInputError('Total attachment size exceeds 25MB', 413);
    }

    const prepared = await Promise.all(
      files.map(async (file) => {
        const extension = extensionOf(file.originalname);
        if (!extension)
          throw new AutomationTemplateInputError(
            `${file.originalname}: only .txt, .md, and .html are allowed`
          );
        if (!file.path) throw new Error(`${file.originalname}: uploaded storage path is missing`);
        const buffer = await storageService.getFileBuffer(normalizeStoragePath(file.path));
        if (buffer.byteLength > AUTOMATION_TEMPLATE_MAX_FILE_BYTES) {
          throw new AutomationTemplateInputError(
            `${file.originalname}: maximum file size is 10MB`,
            413
          );
        }
        const content = decodeUtf8(buffer, file.originalname);
        return {
          originalFilename: file.originalname,
          mimetype: TEMPLATE_TYPES[extension],
          size: buffer.byteLength,
          storagePath: normalizeStoragePath(file.path),
          templatePaths: extractTemplatePaths(content),
        };
      })
    );

    const records = await db.$transaction(
      prepared.map((file) =>
        db.messageAttachment.create({
          data: {
            entityId: stepId,
            entityType: AttachmentEntityType.WORKFLOW_STEPS,
            workspaceId,
            storageProvider: config.fileStorage.provider,
            originalFilename: file.originalFilename,
            mimetype: file.mimetype,
            size: file.size,
            uploadedByUserId: userId,
            createdBy: userId,
            url: file.storagePath,
            conversationId: null,
            uploadStatus: AttachmentUploadStatus.COMPLETED,
            metadata: { automationTemplate: true, templatePaths: file.templatePaths },
          },
        })
      )
    );

    return records.map((record, index) => {
      const file = prepared[index]!;
      return {
        attachmentId: record.id,
        originalFilename: file.originalFilename,
        mimetype: file.mimetype,
        size: file.size,
        templatePaths: file.templatePaths,
      };
    });
  } catch (error) {
    await removeUploadedPaths(files);
    throw error;
  }
}

export async function readAutomationTemplate(params: {
  descriptor: AutomationTemplateAttachment;
  workspaceId: string;
}): Promise<StoredTemplate> {
  const { descriptor, workspaceId } = params;
  const record = await db.messageAttachment.findFirst({
    where: {
      id: descriptor.attachmentId,
      workspaceId,
      entityType: AttachmentEntityType.WORKFLOW_STEPS,
      isDeleted: false,
    },
  });
  const metadata = record?.metadata as { automationTemplate?: unknown } | null;
  if (!record || metadata?.automationTemplate !== true) {
    throw new Error(`Automation template ${descriptor.attachmentId} was not found`);
  }
  const extension = extensionOf(record.originalFilename);
  if (!extension || TEMPLATE_TYPES[extension] !== record.mimetype) {
    throw new Error(`Automation template ${descriptor.attachmentId} has an invalid file type`);
  }
  const storagePath = normalizeStoragePath(record.url);
  const buffer = await storageService.getFileBuffer(storagePath);
  if (buffer.byteLength > AUTOMATION_TEMPLATE_MAX_FILE_BYTES) {
    throw new Error(`${record.originalFilename}: maximum file size is 10MB`);
  }
  const content = decodeUtf8(buffer, record.originalFilename);
  const actualPaths = extractTemplatePaths(content);
  if (!samePaths(actualPaths, descriptor.templatePaths)) {
    throw new Error(
      `${record.originalFilename}: template variables changed; reopen and save the file`
    );
  }
  return {
    descriptor: {
      attachmentId: record.id,
      originalFilename: record.originalFilename,
      mimetype: TEMPLATE_TYPES[extension],
      size: buffer.byteLength,
      templatePaths: actualPaths,
    },
    content,
  };
}

function stringifyTemplateValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && !(value instanceof Date)) {
    return JSON.stringify(value, null, 2);
  }
  return typeof value === 'string' ? value : String(value);
}

export function renderAutomationTemplate(content: string, context: AutomationContext): string {
  return tokenize(content)
    .map((token) =>
      token.kind === 'literal'
        ? token.text
        : stringifyTemplateValue(resolveAutomationPath(context, token.path))
    )
    .join('');
}

export async function prepareRenderedAutomationFiles(params: {
  attachments: AutomationTemplateAttachment[];
  context: AutomationContext;
}): Promise<PreparedAutomationTemplateFile[]> {
  const { attachments, context } = params;
  const stored = await Promise.all(
    attachments.map((descriptor) =>
      readAutomationTemplate({ descriptor, workspaceId: context.automation.workspaceId })
    )
  );
  const rendered = stored.map((file) => {
    const content = renderAutomationTemplate(file.content, context);
    const buffer = Buffer.from(content, 'utf8');
    if (buffer.byteLength > AUTOMATION_TEMPLATE_MAX_FILE_BYTES) {
      throw new Error(`${file.descriptor.originalFilename}: rendered file exceeds 10MB`);
    }
    return { file, buffer };
  });
  const totalSize = rendered.reduce((sum, file) => sum + file.buffer.byteLength, 0);
  if (totalSize > AUTOMATION_TEMPLATE_MAX_TOTAL_BYTES) {
    throw new Error('Rendered attachments exceed the 25MB total limit');
  }

  return rendered.map(({ file, buffer }) => ({
    originalName: file.descriptor.originalFilename,
    mimeType: file.descriptor.mimetype,
    sourceAttachmentId: file.descriptor.attachmentId,
    buffer,
  }));
}

export async function createAutomationDeliveryFiles(params: {
  files: PreparedAutomationTemplateFile[];
  automationId: string;
}): Promise<UploadedFileResult[]> {
  const results = await Promise.allSettled(
    params.files.map(async (file): Promise<UploadedFileResult> => {
      const uploadOptions = {
        filename: file.originalName,
        contentType: file.mimeType,
        scopeType: 'AUTOMATION_DELIVERY',
        scopeId: params.automationId,
        metadata: { sourceAttachmentId: file.sourceAttachmentId },
      };
      const upload =
        file.buffer.byteLength === 0
          ? await storageService.uploadStream(Readable.from(file.buffer), uploadOptions)
          : await storageService.uploadFile(file.buffer, uploadOptions);
      return {
        originalName: file.originalName,
        fileName: file.originalName,
        fileSize: upload.size,
        mimeType: file.mimeType,
        fileUrl: upload.path,
        metadata: {
          automationTemplateSourceId: file.sourceAttachmentId,
          rendered: true,
        },
      };
    })
  );
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failed) {
    await Promise.allSettled(
      results.flatMap((result) =>
        result.status === 'fulfilled' ? [storageService.deleteFile(result.value.fileUrl)] : []
      )
    );
    throw failed.reason;
  }
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

export async function removeUnclaimedAutomationDeliveryFiles(
  files: UploadedFileResult[]
): Promise<void> {
  await Promise.all(
    files.map(async (file) => {
      try {
        const references = await db.messageAttachment.count({ where: { url: file.fileUrl } });
        if (references === 0) await storageService.deleteFile(file.fileUrl);
      } catch (error) {
        logger.error('[automations] failed to inspect a delivery file before cleanup', {
          fileUrl: file.fileUrl,
          error,
        });
      }
    })
  );
}

function collectTemplateAttachmentIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectTemplateAttachmentIds(entry, ids));
    return ids;
  }
  if (!value || typeof value !== 'object') return ids;
  const record = value as Record<string, unknown>;
  if (
    typeof record.attachmentId === 'string' &&
    typeof record.originalFilename === 'string' &&
    Array.isArray(record.templatePaths)
  ) {
    ids.add(record.attachmentId);
  }
  Object.values(record).forEach((entry) => collectTemplateAttachmentIds(entry, ids));
  return ids;
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

async function isTemplateReferenced(
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

export async function releaseAutomationTemplate(params: {
  attachmentId: string;
  workspaceId: string;
}): Promise<boolean> {
  return db.$transaction(async (tx) => {
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

export async function cleanupUnreferencedAutomationTemplates(): Promise<number> {
  let removed = 0;
  let cursor: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const candidates = await db.messageAttachment.findMany({
      where: {
        ...(cursor ? { id: { gt: cursor } } : {}),
        entityType: AttachmentEntityType.WORKFLOW_STEPS,
        isDeleted: false,
        createdAt: { lt: new Date(Date.now() - AUTOMATION_TEMPLATE_GC_GRACE_MS) },
        metadata: { path: ['automationTemplate'], equals: true },
      },
      select: { id: true, workspaceId: true },
      orderBy: { id: 'asc' },
      take: AUTOMATION_TEMPLATE_GC_BATCH_SIZE,
    });
    if (candidates.length === 0) break;
    cursor = candidates[candidates.length - 1]?.id;

    const results = await Promise.allSettled(
      candidates.map((candidate) =>
        releaseAutomationTemplate({
          attachmentId: candidate.id,
          workspaceId: candidate.workspaceId,
        })
      )
    );
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) removed += 1;
      if (result.status === 'rejected') {
        logger.error('[automations] failed to clean up an unreferenced template', result.reason);
      }
    });
    hasMore = candidates.length === AUTOMATION_TEMPLATE_GC_BATCH_SIZE;
    if (!cursor) {
      logger.warn('[automations] Template cleanup stopped because its cursor was unavailable');
      break;
    }
  }
  return removed;
}
