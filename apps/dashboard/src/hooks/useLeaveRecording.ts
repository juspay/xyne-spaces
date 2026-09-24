import { useCallback, type ReactElement } from 'react';
import type { RecordingShareTarget } from '../services/Recording/recordingService';
import { useAuth } from './useAuth';
import { useConfirmDialog } from './useConfirmDialog';

interface UseLeaveRecordingResult {
  /**
   * Confirms, then hands the viewer's own share target to `onConfirm`. Does
   * nothing if they cancel, or before auth hydrates.
   */
  requestLeave: (onConfirm: (target: RecordingShareTarget) => Promise<void>) => Promise<void>;
  /** Render once in the calling surface, as `useConfirmDialog` requires. */
  ConfirmDialog: () => ReactElement | null;
}

/**
 * The "Leave recording" confirmation, shared by the recordings list and the
 * share modal so the warning cannot drift between them — it is the one place
 * that tells someone their access may survive through a group or channel.
 *
 * Leaving revokes the viewer's own grant, so the target is always themselves.
 * What happens afterwards differs per surface — the list refreshes, the modal
 * closes — and stays with the caller.
 */
export const useLeaveRecording = (): UseLeaveRecordingResult => {
  const { user } = useAuth();
  const userId = user?.id;
  const { confirm, ConfirmDialog } = useConfirmDialog();

  const requestLeave = useCallback(
    async (onConfirm: (target: RecordingShareTarget) => Promise<void>): Promise<void> => {
      if (!userId) return;
      const confirmed = await confirm({
        title: 'Leave this recording?',
        description:
          "You'll lose access unless it's shared with you again or through a group or channel.",
        confirmLabel: 'Leave',
        variant: 'destructive',
      });
      if (!confirmed) return;
      await onConfirm({ type: 'user', id: userId });
    },
    [confirm, userId],
  );

  return { requestLeave, ConfirmDialog };
};
