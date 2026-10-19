import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../../hooks/useAuth';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { logger, Event } from '../../utils/logger';

interface CommentTarget {
  id: string;
  createdBy: string;
  deletedAt?: number | null;
}

export interface CanvasCommentUpdate {
  body: string;
  mentionedUserIds: string[];
}

export function useCanvasCommentMutations(editable: boolean) {
  const zero = useZero();
  const { user } = useAuth();
  const pendingRef = useRef(false);
  const [pendingCommentId, setPendingCommentId] = useState<string | null>(null);

  const runMutation = async (
    comment: CommentTarget,
    action: 'update' | 'delete',
    mutate: () => { server: Promise<{ type: string }> },
  ): Promise<boolean> => {
    if (!editable || comment.createdBy !== user?.id || comment.deletedAt || pendingRef.current)
      return false;
    pendingRef.current = true;
    setPendingCommentId(comment.id);
    try {
      const result = await mutate().server;
      if (result.type === 'error') {
        toast.error(`Unable to ${action} comment`);
        return false;
      }
      return true;
    } catch (error) {
      toast.error(`Unable to ${action} comment`);
      logger.error(Event.API_CALL_FAILED, { reason: error, context: `canvas_comment_${action}` });
      return false;
    } finally {
      pendingRef.current = false;
      setPendingCommentId(null);
    }
  };

  return {
    pendingCommentId,
    updateComment: (comment: CommentTarget, payload: CanvasCommentUpdate): Promise<boolean> =>
      runMutation(comment, 'update', () =>
        zero.mutate(
          mutators.canvasComment.updateComment({
            commentId: comment.id,
            ...payload,
            timestamp: Date.now(),
          }),
        ),
      ),
    deleteComment: (comment: CommentTarget): Promise<boolean> =>
      runMutation(comment, 'delete', () =>
        zero.mutate(
          mutators.canvasComment.deleteComment({
            commentId: comment.id,
            timestamp: Date.now(),
          }),
        ),
      ),
  };
}
