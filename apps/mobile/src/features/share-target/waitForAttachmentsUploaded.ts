import { isAttachmentUploaded } from '@xyne/shared/zero/mutators';

import type { useZero } from '@/src/hooks/useZero';
import { queries } from '@/src/zero/queries';

const DEFAULT_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * `addAttachments` resolves once the upload request returns, but the server's
 * COMPLETED status reaches the local Zero replica a moment later. Sending
 * before that makes the optimistic `conversations.send` throw
 * ATTACHMENT_STILL_UPLOADING, so wait until the replica agrees. On timeout the
 * send proceeds and the mutator decides.
 */
export async function waitForAttachmentsUploaded(
  zero: NonNullable<ReturnType<typeof useZero>>,
  attachmentIds: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (attachmentIds.length > 0 && Date.now() < deadline) {
    const drafts = await zero.run(queries.userDrafts());
    const uploadedIds = new Set(
      drafts
        .flatMap(draft => draft.attachments)
        .filter(isAttachmentUploaded)
        .map(attachment => attachment.id),
    );
    if (attachmentIds.every(id => uploadedIds.has(id))) return;
    await sleep(POLL_INTERVAL_MS);
  }
}
