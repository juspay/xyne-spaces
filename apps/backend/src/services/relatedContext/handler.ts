import { Request, Response } from 'express';
import { findRelatedContext } from './index';

/**
 * POST /api/vespaSearch/related `{ text, conversationId? }` → `{ success, data: RelatedContext | null }`
 *
 * POST, not GET: the draft is unsent text and must not end up in URLs, which
 * proxies and access logs record.
 */
export const relatedContextHandler = async (req: Request, res: Response): Promise<void> => {
  const user = req.user;
  const userId = user?.id;
  const workspaceId = user?.workspaceId;
  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  if (!workspaceId) {
    res.status(403).json({ success: false, error: 'Forbidden: workspace context required' });
    return;
  }

  // The composer drops this request the moment the user types on. When the
  // connection closes before we answer, stop: every search and Jev call still to
  // come would be for a draft that no longer exists.
  const abandoned = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abandoned.abort();
  });

  const { text, conversationId } = req.body as { text: string; conversationId?: string };
  // The whole ACL context, not just the id: every result is checked against the
  // caller's read rules, and those depend on their role (a guest sees less).
  const auth = {
    userId,
    workspaceId,
    ...(user?.role ? { role: user.role } : {}),
    ...(user?.orgRole ? { orgRole: user.orgRole } : {}),
    ...(user?.memberId ? { memberId: user.memberId } : {}),
  };
  const data = await findRelatedContext(
    text,
    { auth, ...(conversationId ? { conversationId } : {}) },
    abandoned.signal
  );
  if (abandoned.signal.aborted) return;
  res.json({ success: true, data });
};
