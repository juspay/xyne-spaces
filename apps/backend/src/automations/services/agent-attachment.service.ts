/**
 * Files a claw agent produced during a run, shipped back base64-encoded on the
 * terminal callback (`resultAttachments` in xyne-claw/src/routes/run.ts).
 *
 * Adapts base64 → the multer shape `uploadFiles()` wants; the upload itself is
 * delegated there, so agent screenshots get the same thumbnails and dimensions
 * as any other attachment. Not automation-template.service — those are
 * build-time files with {{variables}} to render, these are runtime bytes.
 */
import { z } from 'zod';
import { uploadFiles, type UploadedFileResult } from '@/services/fileUploadService';
import { logger } from '@/utils/logger';
import type { AutomationContext } from '../types/context';

export const AGENT_ATTACHMENT_MAX_FILES = 10;
export const AGENT_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const AGENT_ATTACHMENT_MAX_TOTAL_BYTES = 25 * 1024 * 1024;

export const AgentAttachmentSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  data: z.string().min(1),
});

export type AgentAttachment = z.infer<typeof AgentAttachmentSchema>;

/** Strip a data: URI prefix and whitespace so Buffer.from won't truncate. */
function normalizeBase64(data: string): string {
  return data.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
}

/**
 * Malformed entries are dropped rather than failing the step — the agent's text
 * answer is worth posting even when one file is unusable.
 */
export function parseAgentAttachments(value: unknown): AgentAttachment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    // Usually an unresolved variable reference; don't fail silently.
    logger.warn(
      `[agent-attachments] expected an array of attachments, got ${typeof value} — ignoring: ${String(value).slice(0, 200)}`,
    );
    return [];
  }
  const parsed: AgentAttachment[] = [];
  for (const entry of value) {
    const result = AgentAttachmentSchema.safeParse(entry);
    if (result.success) {
      parsed.push(result.data);
      continue;
    }
    logger.warn(
      `[agent-attachments] dropping malformed attachment: ${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed;
}

/**
 * Files from the most recent agent step in this run. Nothing to configure —
 * the @mention path posts text and files together, and steps behave the same.
 */
export function agentAttachmentsFromContext(context: AutomationContext): AgentAttachment[] {
  let found: AgentAttachment[] = [];
  let fromStep = '';
  for (const [stepId, entry] of Object.entries(context.steps)) {
    const parsed = parseAgentAttachments(entry.output?.['attachments']);
    if (parsed.length > 0) {
      found = parsed;
      fromStep = stepId;
    }
  }
  if (found.length > 0) {
    logger.info(`[agent-attachments] using ${found.length} file(s) from step ${fromStep}`);
  }
  return found;
}

/** Decode and upload, returning descriptors for `uploadedFiles`. */
export async function uploadAgentAttachments(params: {
  attachments: AgentAttachment[];
  automationId: string;
}): Promise<UploadedFileResult[]> {
  const { attachments, automationId } = params;
  if (attachments.length === 0) return [];

  const capped = attachments.slice(0, AGENT_ATTACHMENT_MAX_FILES);
  if (capped.length < attachments.length) {
    logger.warn(
      `[agent-attachments] automation ${automationId} returned ${attachments.length} attachments; keeping the first ${AGENT_ATTACHMENT_MAX_FILES}`,
    );
  }

  const files: Express.Multer.File[] = [];
  let totalBytes = 0;
  for (const attachment of capped) {
    const buffer = Buffer.from(normalizeBase64(attachment.data), 'base64');
    if (buffer.byteLength === 0) {
      logger.warn(
        `[agent-attachments] skipping "${attachment.fileName}" — base64 payload decoded to 0 bytes`,
      );
      continue;
    }
    if (buffer.byteLength > AGENT_ATTACHMENT_MAX_FILE_BYTES) {
      logger.warn(
        `[agent-attachments] skipping "${attachment.fileName}" — ${buffer.byteLength} bytes exceeds the ${AGENT_ATTACHMENT_MAX_FILE_BYTES} byte per-file limit`,
      );
      continue;
    }
    if (totalBytes + buffer.byteLength > AGENT_ATTACHMENT_MAX_TOTAL_BYTES) {
      logger.warn(
        `[agent-attachments] skipping "${attachment.fileName}" — would exceed the ${AGENT_ATTACHMENT_MAX_TOTAL_BYTES} byte total limit`,
      );
      continue;
    }
    totalBytes += buffer.byteLength;
    // uploadFiles reads only these; `path` must stay unset so it uploads
    // rather than reusing an existing storage path.
    files.push({
      originalname: attachment.fileName,
      mimetype: attachment.mimeType,
      size: buffer.byteLength,
      buffer,
    } as Express.Multer.File);
  }

  if (files.length === 0) return [];
  return uploadFiles(files);
}
