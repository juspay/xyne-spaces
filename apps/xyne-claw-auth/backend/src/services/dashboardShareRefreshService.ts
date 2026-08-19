import {
  persistBase64ChatAttachments,
  type Base64Attachment,
  type PersistedAttachmentRef,
} from "./chatAttachmentService.js";
import { upsertDesignShare } from "../routes/design-shares.js";

export function isDashboardTask(task: string): boolean {
  return /^\s*\/dashboard(?:\s|$)/i.test(task);
}

export async function refreshScheduledDashboardShare(params: {
  task: string;
  chatMessageId: string;
  ownerUserId: string;
  orgId: string;
  conversationId: string | null;
  attachments: Base64Attachment[] | undefined;
}): Promise<{
  persistedAttachments: PersistedAttachmentRef[];
  share: { id: string; sharePath: string; linkChanged: boolean } | null;
  reason: "not_dashboard" | "missing_conversation" | "missing_html" | "refreshed";
}> {
  if (!isDashboardTask(params.task)) {
    return { persistedAttachments: [], share: null, reason: "not_dashboard" };
  }

  const persistedAttachments = await persistBase64ChatAttachments(
    params.chatMessageId,
    params.ownerUserId,
    params.attachments,
  );
  const html = [...persistedAttachments].reverse().find((attachment) =>
    attachment.mimeType.toLowerCase().includes("html") || attachment.originalFilename.toLowerCase().endsWith(".html"),
  );
  if (!html) return { persistedAttachments, share: null, reason: "missing_html" };
  if (!params.conversationId) return { persistedAttachments, share: null, reason: "missing_conversation" };

  const share = await upsertDesignShare({
    ownerUserId: params.ownerUserId,
    orgId: params.orgId,
    conversationId: params.conversationId,
    attachmentId: html.id,
    title: html.originalFilename.replace(/\.html?$/i, ""),
    expiresAt: null,
  });
  return { persistedAttachments, share, reason: "refreshed" };
}
