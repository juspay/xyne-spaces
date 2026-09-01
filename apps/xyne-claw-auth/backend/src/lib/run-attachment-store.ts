/**
 * Off-body storage for run attachments.
 *
 * Base64-inlining every Spaces attachment into the /run body is what makes a
 * handful of screenshots a multi-megabyte JSON payload that has to be copied
 * through the dispatch path (and, with XYNE_RUN_QUEUE=1, through Redis) before
 * the agent ever looks at it. Behind XYNE_RUN_ATTACHMENT_REFS=1 the bytes go to
 * the shared object store instead and the payload carries only a `gcsRef`;
 * xyne-claw pulls them back with its own storage client at ingest time.
 *
 * Object layout: run-attachments/{conversationId}/{attachmentId}
 * Bucket/credentials come from the SAME place as every other claw-auth object
 * (services/storageService.ts → GCS_BUCKET_NAME / STORAGE_PROVIDER, ADC).
 */
import { gcsService } from "../services/storageService.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("run-attachment-store");

export const RUN_ATTACHMENT_PREFIX = "run-attachments";

export function runAttachmentRefsEnabled(): boolean {
  return CONFIG.runAttachmentRefs;
}

export function runAttachmentObjectPath(scopeId: string, attachmentId: string): string {
  const safe = (value: string): string => value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 160);
  return `${RUN_ATTACHMENT_PREFIX}/${safe(scopeId)}/${safe(attachmentId)}`;
}

export interface UploadedRunAttachment {
  gcsRef: string;
  sizeBytes: number;
}

/**
 * Upload one attachment's bytes and return its ref. Returns null on any storage
 * failure so the caller can fall back to inlining base64 — a storage hiccup must
 * never cost the user their attachment.
 */
export async function uploadRunAttachment(
  scopeId: string,
  attachmentId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<UploadedRunAttachment | null> {
  const gcsRef = runAttachmentObjectPath(scopeId, attachmentId);
  try {
    await gcsService.uploadFile(buffer, gcsRef, mimeType || "application/octet-stream");
    return { gcsRef, sizeBytes: buffer.length };
  } catch (err) {
    log.warn(
      `[run-attachments] upload failed for ${gcsRef}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
