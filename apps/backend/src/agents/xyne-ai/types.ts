/**
 * Shared attachment request type.
 *
 * (What remains after the Ask AI V1 agent loop was removed — the request/
 * streaming/citation/history types that lived here went with it. Kept only
 * for `AttachmentData`, consumed by the attachment upload/retrieval services.)
 */

/**
 * Attachment data from request
 */
export interface AttachmentData {
  data: string;  // Base64-encoded file content
  mime_type: string;
  filename?: string;
}
