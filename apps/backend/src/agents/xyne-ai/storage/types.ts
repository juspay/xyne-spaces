/**
 * GCS attachment metadata type.
 *
 * (What remains after the Ask AI V1 session store was removed — the session/
 * history/message types that lived here went with it. Kept only for
 * `AttachmentMetadata`, consumed by the attachment retrieval service.)
 */

/**
 * GCS Attachment Metadata
 * Stored in WorkflowStep.attachment column as JSON string
 */
export interface AttachmentMetadata {
  attachment_id: string;  // Unique ID for this attachment
  url: string;            // GCS path (e.g., "attachments/ASKAI/session_abc/...")
  mime_type: string;      // MIME type (e.g., "image/png")
  file_name: string;      // Sanitized filename
  size: number;           // File size in bytes
}
