import { useCallback } from 'react';
import { useSelector } from '@xstate/react';
import {
  attachmentViewerActor,
  AttachmentViewerState,
} from '../../../machines/attachmentViewerMachine';

/**
 * Whether THIS inline video is the one open in the attachment modal.
 *
 * Subscribes to a single boolean. The modal's playback time changes on every
 * `timeupdate` (~4 Hz, SET_VIDEO_TIME), and selecting it — or returning a fresh
 * object — re-rendered every inline video bubble in the chat on every tick.
 * The time is only needed at the open→closed transition, so it is read lazily
 * from the actor via `readModalVideoTime()` (CLOSE preserves currentVideoTime).
 */
export function useInlineVideoModalState(attachmentId: string): {
  isOpenInModal: boolean;
  readModalVideoTime: () => number | undefined;
} {
  const isOpenInModal = useSelector(attachmentViewerActor, (s: AttachmentViewerState) => {
    if (s.value === 'closed') return false;
    return s.context.attachments[s.context.currentIndex]?.attachmentId === attachmentId;
  });
  const readModalVideoTime = useCallback(
    () => attachmentViewerActor.getSnapshot().context.currentVideoTime,
    [],
  );
  return { isOpenInModal, readModalVideoTime };
}
