import { db } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { logger } from '@/utils/logger';
import { messageMetadataService } from '@/services/messageMetadataService';
import {
  parseXPostPreviewMd,
  serializeXPostPreviewMd,
  type XPostPreviewData,
  type XPostTldrStatus,
} from '@xyne/shared';
import { getOrGenerateXPostTldr } from './xPostService';

export interface XPostTldrJobData {
  messageId: string;
  conversationId: string;
  postId: string;
}

export type XPostTldrOutcome = 'ready' | 'failed' | 'stale';

/**
 * Read the message's current X card. Null when the message is gone or no longer carries a
 * pending card for this post — e.g. it was deleted, or a newer preview replaced it.
 */
async function loadPendingCard(messageId: string, postId: string): Promise<XPostPreviewData | null> {
  const message = await withWorkspaceScope(() =>
    db.message.findUnique({
      where: { messageId },
      select: { link_preview_md: true, isDeleted: true },
    }),
  );
  if (!message || message.isDeleted) return null;
  const card = parseXPostPreviewMd(message.link_preview_md);
  if (!card || card.postId !== postId || card.tldrStatus !== 'pending') return null;
  return card;
}

async function writeCard(
  messageId: string,
  conversationId: string,
  card: XPostPreviewData,
  tldrStatus: XPostTldrStatus,
  tldr?: string,
): Promise<void> {
  const next: XPostPreviewData = { ...card, tldrStatus, ...(tldr ? { tldr } : {}) };
  const md = serializeXPostPreviewMd(next);
  if (!md) return;
  // Runs in the worker, outside any user's request scope.
  await withWorkspaceScope(() => db.message.update({ where: { messageId }, data: { link_preview_md: md } }));
  await messageMetadataService.syncInitialMessageMd(conversationId);
}

/**
 * Fill in the TLDR on a pending X card.
 *
 * `isFinalAttempt` decides what a thrown error means: a retry is still coming, so the card
 * stays "pending"; on the last attempt it is flipped to "failed" so the UI stops showing a
 * spinner forever.
 */
export async function processXPostTldrJob(
  data: XPostTldrJobData,
  isFinalAttempt: boolean,
): Promise<XPostTldrOutcome> {
  const { messageId, conversationId, postId } = data;
  const card = await loadPendingCard(messageId, postId);
  if (!card) return 'stale';

  let tldr: string | null;
  try {
    tldr = await getOrGenerateXPostTldr({
      postId,
      authorName: card.authorName,
      authorHandle: card.authorHandle,
      text: card.text,
      ...(card.createdAt ? { createdAt: card.createdAt } : {}),
    });
  } catch (error) {
    if (!isFinalAttempt) throw error;
    logger.error('[XPostTldr] Giving up after final attempt', { messageId, postId, error });
    tldr = null;
  }

  // Re-read: the message may have changed while the model was running.
  const latest = await loadPendingCard(messageId, postId);
  if (!latest) return 'stale';

  if (!tldr) {
    await writeCard(messageId, conversationId, latest, 'failed');
    return 'failed';
  }
  await writeCard(messageId, conversationId, latest, 'ready', tldr);
  return 'ready';
}
