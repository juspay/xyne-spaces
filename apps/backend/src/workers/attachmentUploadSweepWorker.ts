import { AttachmentUploadStatus } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

const TAG = '[AttachmentUploadSweepWorker]';

/**
 * An upload has this long to land before it is written off.
 *
 * Generous on purpose: a large file on a poor connection is slow, not dead, and failing a
 * live upload would blank an attachment the user can still see arriving. The cost of waiting
 * is only that a genuinely dead tile keeps spinning a while longer.
 */
const STALE_UPLOAD_MS = 30 * 60 * 1000;

/**
 * Fails out uploads that stopped without telling anyone.
 *
 * A row is created PENDING with an empty url the moment a file is picked, and the upload
 * fills it in later. Three parties can mark that upload dead — the controller when a file
 * errors, the multer handler when the transfer breaks, and the client when its own request
 * rejects — but none of them observe the case that matters most: a browser that disappears
 * mid-transfer. The tab closes, nothing errors anywhere, and the row stays PENDING.
 *
 * That used to be invisible, because the composer refused to send while an attachment was
 * uploading. Now that a message posts immediately and its attachment fills in afterwards,
 * such a row is a tile that spins forever in a sent message, for every viewer. This is the
 * backstop that turns it into a visible failure.
 */
class AttachmentUploadSweepWorker {
  async run(): Promise<{ failed: number }> {
    const cutoff = new Date(Date.now() - STALE_UPLOAD_MS);

    // `url: ''` rather than a null check: the row is created with an empty string, and the
    // upload writing a url is the real completion signal — a status left behind by a crash
    // halfway through is not to be trusted on its own.
    const { count } = await db.messageAttachment.updateMany({
      where: {
        uploadStatus: AttachmentUploadStatus.PENDING,
        url: '',
        createdAt: { lt: cutoff },
      },
      data: { uploadStatus: AttachmentUploadStatus.FAILED },
    });

    if (count > 0) {
      logger.warn(`${TAG} Marked ${count} stale upload(s) FAILED (older than 30m, still url-less)`);
    } else {
      logger.info(`${TAG} No stale uploads found`);
    }

    return { failed: count };
  }
}

export const attachmentUploadSweepWorker = new AttachmentUploadSweepWorker();
