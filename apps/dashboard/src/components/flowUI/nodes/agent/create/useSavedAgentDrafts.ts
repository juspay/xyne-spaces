import { useCallback, useEffect, useState } from 'react';
import {
  agentDraftStorageKey,
  clearAgentDraft,
  listSavedAgentDrafts,
  type SavedAgentDraft,
} from './agentCreateDraftStorage';

/**
 * The drafts this user saved in this workspace, for Agent Hub. Re-read when
 * the window regains focus or another tab changes storage, so a draft saved
 * or created elsewhere shows up without a reload.
 */
export function useSavedAgentDrafts(
  workspaceId: string | undefined,
  userId: string | undefined,
): { drafts: SavedAgentDraft[]; remove: (id: string) => void } {
  const read = useCallback(
    (): SavedAgentDraft[] => (userId ? listSavedAgentDrafts(workspaceId, userId) : []),
    [workspaceId, userId],
  );
  const [drafts, setDrafts] = useState<SavedAgentDraft[]>(read);

  useEffect(() => {
    const refresh = (): void => setDrafts(read());
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return (): void => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [read]);

  const remove = useCallback(
    (id: string): void => {
      clearAgentDraft(agentDraftStorageKey(workspaceId, userId, id));
      setDrafts(read());
    },
    [read, userId, workspaceId],
  );

  return { drafts, remove };
}
