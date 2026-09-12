import type { AppEventAttachment } from '@/apps/types';

/**
 * Maximum number of referenced (tagged) files we will resolve for a single
 * message. This bounds the work done on the dispatch path and prevents a
 * crafted message from forcing a large number of attachment lookups.
 */
export const MAX_FILE_REFERENCES = 10;

/**
 * Minimal shape of a stored attachment row that this module needs.
 * Declared locally to avoid coupling to the Prisma client type and to keep
 * the resolver easy to unit test with a fake repository.
 */
export interface ReferencedAttachmentRow {
  id: string;
  workspaceId: string;
  conversationId: string | null;
  originalFilename: string;
  mimetype: string;
  size: number;
  url: string;
  isDeleted?: boolean | null;
}

export interface ReferencedAttachmentRepo {
  findById(id: string): Promise<ReferencedAttachmentRow | null>;
}

export interface ResolveReferencedAttachmentsContext {
  workspaceId: string;
  /** Conversation (thread) the triggering message belongs to. */
  conversationId: string;
  repo: ReferencedAttachmentRepo;
}

// A file-reference chip is serialized by the composer as
//   <span data-file-reference data-attachment-id="..." ...>@name</span>
// We locate each such span and pull the attachment id out of it. Attribute
// order is not guaranteed, so we match the tag first, then the id within it.
const FILE_REFERENCE_TAG_RE = /<span\b[^>]*\bdata-file-reference\b[^>]*>/gi;
const ATTACHMENT_ID_RE = /\bdata-attachment-id\s*=\s*"([^"]+)"/i;

/**
 * Parse the stable attachment ids out of a message's HTML content.
 *
 * Returns a de-duplicated, order-preserving list of ids. The ids are
 * client-supplied and MUST NOT be trusted for access — every id has to be
 * re-authorized against the store via {@link resolveReferencedAttachments}.
 */
export function extractFileReferenceIds(content: string | null | undefined): string[] {
  if (!content) return [];

  const ids: string[] = [];
  const seen = new Set<string>();

  const tags = content.match(FILE_REFERENCE_TAG_RE);
  if (!tags) return [];

  for (const tag of tags) {
    const match = tag.match(ATTACHMENT_ID_RE);
    const id = match?.[1]?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_FILE_REFERENCES) break;
  }

  return ids;
}

/**
 * Resolve and AUTHORIZE a list of client-supplied attachment ids into
 * app-event attachments.
 *
 * An id survives only if the underlying attachment:
 *   - exists and is not soft-deleted,
 *   - belongs to the same workspace as the triggering message, and
 *   - belongs to the same conversation (thread) as the triggering message.
 *
 * The conversation check is the boundary that stops a crafted message from
 * tagging an arbitrary file elsewhere in the workspace. Ids that fail any
 * check are silently dropped rather than throwing, so one bad reference never
 * blocks delivery of the rest of the event.
 */
export async function resolveReferencedAttachments(
  attachmentIds: string[],
  ctx: ResolveReferencedAttachmentsContext,
): Promise<AppEventAttachment[]> {
  if (!attachmentIds.length) return [];

  const { workspaceId, conversationId, repo } = ctx;
  const bounded = attachmentIds.slice(0, MAX_FILE_REFERENCES);

  const rows = await Promise.all(
    bounded.map(id => repo.findById(id).catch(() => null)),
  );

  const resolved: AppEventAttachment[] = [];

  for (const att of rows) {
    if (!att) continue;
    if (att.isDeleted) continue;
    if (!att.url) continue;
    if (workspaceId && att.workspaceId !== workspaceId) continue;
    if (!att.conversationId || att.conversationId !== conversationId) continue;

    resolved.push({
      attachmentId: att.id,
      fileName: att.originalFilename,
      fileSize: att.size,
      mimeType: att.mimetype,
      fileUrl: att.url,
    });
  }

  return resolved;
}

/**
 * Merge referenced attachments into the list of attachments physically
 * uploaded on the message, de-duplicating by attachment id. Uploaded
 * attachments win on collision. This lets recipients (e.g. Claw) receive
 * tagged files through the existing attachment pipeline with no change on
 * their side, while {@link AppMentionEventPayload.referencedAttachments}
 * preserves the provenance distinction.
 */
export function mergeAttachments(
  uploaded: AppEventAttachment[] | undefined,
  referenced: AppEventAttachment[] | undefined,
): AppEventAttachment[] {
  const out: AppEventAttachment[] = [];
  const seen = new Set<string>();

  for (const att of [...(uploaded ?? []), ...(referenced ?? [])]) {
    if (seen.has(att.attachmentId)) continue;
    seen.add(att.attachmentId);
    out.push(att);
  }

  return out;
}
