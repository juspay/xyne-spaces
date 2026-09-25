import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import { ingestDeliveredArtifact } from "./conversation-artifact-signals.js";
import { designShareUrl, upsertDesignShare } from "../routes/design-shares.js";
import { setArtifactVersionRef } from "./conversation-artifacts.js";
import { isWorkspaceDiffMimeType, workspaceDiffRefId } from "./workspace-diff.js";

const log = createLogger("delivered-artifacts");

export interface DeliveredAttachment {
  id: string;
  originalFilename: string;
  mimeType: string;
}

export interface RecordDeliveredArtifactsArgs {
  conversationId: string;
  userId: string;
  orgId: string | null;
  messageId: string | null;
  task: string | null;
  attachments: DeliveredAttachment[];
  allowDesignShare?: boolean;
}

export function deliveredDesignCommand(task: string | null | undefined): string | null {
  return task?.trimStart().toLowerCase().match(/^\/(design|dashboard)(?:\s|$)/)?.[1] ?? null;
}

function findDeliveredHtml(attachments: DeliveredAttachment[]): DeliveredAttachment | undefined {
  return [...attachments].reverse().find((a) =>
    a.mimeType.toLowerCase().includes("html") || a.originalFilename.toLowerCase().endsWith(".html"),
  );
}

export async function recordDeliveredArtifacts(
  args: RecordDeliveredArtifactsArgs,
): Promise<{ designShareUrl: string | null }> {
  const { conversationId, userId, orgId, messageId, task, attachments } = args;
  if (!conversationId || !userId || attachments.length === 0) return { designShareUrl: null };

  const isSpec = /^\/spec(?:\s|$)/.test(task?.trimStart().toLowerCase() ?? "");
  const isReview = /^\/review(?:\s|$)/.test(task?.trimStart().toLowerCase() ?? "");
  const isLearn = /^\/learn(?:\s|$)/.test(task?.trimStart().toLowerCase() ?? "");
  const designCommand = deliveredDesignCommand(task);
  const designHtml =
    designCommand && orgId && args.allowDesignShare !== false ? findDeliveredHtml(attachments) : undefined;
  // A review room is its own kind, keyed by the delivered file: every run
  // leaves a new room instead of re-pointing one share, and it never enters
  // the design pane where a follow-up message would revise it.
  const reviewRoom = isReview || isLearn ? findDeliveredHtml(attachments) : undefined;

  for (const file of attachments) {
    if (designHtml && file.id === designHtml.id) continue;
    if (reviewRoom && file.id === reviewRoom.id) {
      try {
        await ingestDeliveredArtifact(
          { conversationId, userId, orgId, messageId },
          {
            kind: isLearn ? "LESSON" : "REVIEW_ROOM",
            refId: file.id,
            title:
              file.originalFilename.replace(/\.html?$/i, "") || (isLearn ? "Lesson" : "Review room"),
            latestVersionRef: file.id,
          },
        );
      } catch (err) {
        log.warn(`[delivered-artifacts] html room ingest failed (non-fatal): ${errMsg(err)}`);
      }
      continue;
    }
    // A local workspace patch is already represented by the conversation's DIFF
    // row (written when the harness reported the run). Recording it again as a
    // FILE would double it up in the panel, so only its version ref is linked.
    if (isWorkspaceDiffMimeType(file.mimeType)) {
      try {
        await setArtifactVersionRef({
          conversationId,
          kind: "DIFF",
          refId: workspaceDiffRefId(conversationId),
          latestVersionRef: file.id,
          messageId,
        });
      } catch (err) {
        log.warn(`[delivered-artifacts] workspace diff version link failed (non-fatal): ${errMsg(err)}`);
      }
      continue;
    }
    try {
      await ingestDeliveredArtifact(
        { conversationId, userId, orgId, messageId },
        {
          kind: isSpec ? "SPEC" : "FILE",
          refId: file.id,
          title: file.originalFilename,
          latestVersionRef: file.id,
        },
      );
    } catch (err) {
      log.warn(`[delivered-artifacts] file ingest failed (non-fatal): ${errMsg(err)}`);
    }
  }

  const command = deliveredDesignCommand(task);
  if (!command || !orgId || args.allowDesignShare === false) return { designShareUrl: null };
  const html = findDeliveredHtml(attachments);
  if (!html) return { designShareUrl: null };

  try {
    const title = html.originalFilename.replace(/\.html?$/i, "");
    const share = await upsertDesignShare({
      ownerUserId: userId,
      orgId,
      conversationId,
      attachmentId: html.id,
      title,
      expiresAt: null,
    });
    const link = designShareUrl(share.sharePath);
    await ingestDeliveredArtifact(
      { conversationId, userId, orgId, messageId },
      {
        kind: "DESIGN_HTML",
        refId: share.id,
        title,
        latestVersionRef: html.id,
        url: link,
      },
    );
    log.info(`[delivered-artifacts] design share ready shareId=${share.id} conv=${conversationId}`);
    return { designShareUrl: link };
  } catch (err) {
    log.warn(`[delivered-artifacts] design share publish failed (non-fatal): ${errMsg(err)}`);
    return { designShareUrl: null };
  }
}
