import { useEffect } from 'react';
import type { RefObject } from 'react';
import {
  attachmentViewerActor,
  type AttachmentRef,
} from '../../../machines/attachmentViewerMachine';
import type { ColumnSource } from '../components/Streams/Streams.types';

/**
 * Files, redirected from the app's viewer into a column.
 *
 * Every other item column arrives through `columnIntent`, because every other
 * item is reached by navigating. A file is not: clicking an attachment anywhere
 * in Xyne sends `OPEN` to one global XState actor, and a modal over the whole
 * page renders whatever that actor is holding. There is no URL to read.
 *
 * A modal is the one shape a stream cannot use. Its entire proposition is that
 * opening something does not cost you the things beside it, and a full-screen
 * overlay costs you all of them at once. So while Streams is on screen the stream
 * takes the handoff: it watches the actor, converts what was about to be shown
 * into a column, and closes the viewer.
 *
 * The close is sent from inside the subscription, which runs synchronously
 * inside `send()` — so the modal is closed again before React has a frame to
 * paint it in, and nothing flashes. Everywhere else in the app the actor
 * behaves exactly as it always did; this hook unsubscribes with the screen.
 */

const sourceFor = (attachment: AttachmentRef): ColumnSource | null => {
  // `attachmentId` is what the download URL is built from, so a ref without one
  // (an upload still in flight, a synthetic preview) has nothing a column could
  // fetch. Those are left to the modal.
  if (!attachment.attachmentId) return null;
  return {
    kind: 'file',
    attachmentId: attachment.attachmentId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    ...(typeof attachment.fileSize === 'number' && { fileSize: attachment.fileSize }),
    ...(attachment.channelId && { channelId: attachment.channelId }),
  };
};

export const useAttachmentColumns = (
  openBeside: (fromColumnId: string, source: ColumnSource) => void,
  /**
   * The column the file came from, read at the moment it opens.
   *
   * A ref rather than a value, so this subscribes once instead of tearing down
   * and re-subscribing every time focus moves. Focus is the right answer here
   * because opening a file is a click, and a click inside a column focuses it
   * before anything else happens — so the focused column *is* the one holding
   * the attachment.
   */
  fromColumnRef: RefObject<string | undefined>,
): void => {
  useEffect(() => {
    let wasOpen = attachmentViewerActor.getSnapshot().value !== 'closed';

    const subscription = attachmentViewerActor.subscribe(snapshot => {
      const isOpen = snapshot.value !== 'closed';
      // Only the closed → open edge. The actor churns through `opening`,
      // `viewing` and back on its own, and reacting to each would try to open
      // the same column three times.
      if (!isOpen) {
        wasOpen = false;
        return;
      }
      if (wasOpen) return;
      wasOpen = true;

      const attachment = snapshot.context.attachments[snapshot.context.currentIndex];
      const source = attachment ? sourceFor(attachment) : null;
      const from = fromColumnRef.current;
      // Nothing to open, or nowhere to open it beside — let the modal have it
      // rather than swallowing the click and showing nothing.
      if (!source || !from) return;

      openBeside(from, source);
      attachmentViewerActor.send({ type: 'CLOSE' });
      wasOpen = false;
    });

    return () => subscription.unsubscribe();
  }, [openBeside, fromColumnRef]);
};
