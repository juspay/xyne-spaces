import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/src/contexts/AuthContext';
import { logger as structuredLogger } from '@/src/observability/logging/appLogger';
import { getCachedMemberWorkspaces, loadMemberWorkspaces } from '@/src/services/memberWorkspaces';
import { getActiveWorkspaceId } from '@/src/utils/activeWorkspace';
import {
  resolveDeepLinkWorkspaceDecision,
  type DeepLinkWorkspace,
} from '@/src/utils/deepLinkWorkspace';
import {
  messageDeepLinkScopeSegments,
  type DeepLinkScopePayload,
} from '@/src/utils/messageDeepLinkCore';

type DeepLinkWorkspaceSwitchOptions = {
  /** Re-run the pending deep link; the target workspace is now active. */
  readonly onWorkspaceReady: () => void;
  /** The link cannot be opened — drop it and clear the pending state. */
  readonly onAbandoned: () => void;
};

export type DeepLinkWorkspaceSwitch = {
  /**
   * Workspace being entered while a switch is in flight, `''` when the switch was
   * started before its name was known, and `null` when no switch is running. Drives
   * the "Switching to …" overlay.
   */
  readonly switchingToWorkspaceName: string | null;
  /**
   * Called once the pending link has actually been opened (or dropped). Ends the
   * overlay — the switch itself finishes well before the new session has a screen to
   * show, so releasing it any earlier puts the startup screen on display mid-flow.
   */
  readonly complete: () => void;
  /**
   * Claims a parsed link that targets another workspace. Returns true when the link
   * is being handled here and must NOT be opened yet — the caller should return and
   * wait for `onWorkspaceReady`.
   */
  readonly claim: (payload: DeepLinkScopePayload) => boolean;
  /** Forget the current claim so a freshly arriving link is attempted again. */
  readonly reset: () => void;
};

/**
 * Owns the workspace switch a cross-workspace deep link needs.
 *
 * A link into another workspace cannot be opened in place: the channel is absent from
 * the active workspace's store, so the chat screen lands on "This message is
 * unavailable". This hook enters the target workspace first and then asks the caller
 * to re-open the link, which by then resolves against the new workspace's store.
 *
 * Each set of scope segments is attempted once. Without that guard the post-switch
 * re-entry — or any re-render of the pending-link effect — would start the switch
 * again, so a workspace the user cannot enter would retry forever.
 */
export function useDeepLinkWorkspaceSwitch({
  onWorkspaceReady,
  onAbandoned,
}: DeepLinkWorkspaceSwitchOptions): DeepLinkWorkspaceSwitch {
  const { token, switchWorkspace } = useAuth();
  const [switchingToWorkspaceName, setSwitchingToWorkspaceName] = useState<string | null>(null);
  const claimedScopeRef = useRef<string | null>(null);

  const complete = useCallback((): void => {
    setSwitchingToWorkspaceName(null);
  }, []);

  const reset = useCallback((): void => {
    claimedScopeRef.current = null;
    setSwitchingToWorkspaceName(null);
  }, []);

  const abandon = useCallback((): void => {
    setSwitchingToWorkspaceName(null);
    onAbandoned();
  }, [onAbandoned]);

  const resolveAndSwitch = useCallback(
    async (segments: readonly string[], activeWorkspaceId: string): Promise<void> => {
      // A cached list keeps the common case request-free; the fetch only happens the
      // first time a cross-workspace link arrives in a session.
      let memberWorkspaces: readonly DeepLinkWorkspace[] | null = getCachedMemberWorkspaces();
      if (!memberWorkspaces && token) {
        memberWorkspaces = await loadMemberWorkspaces(token).catch((error: unknown) => {
          structuredLogger.warn('deep_link_workspace_switch_member_list_failed', { error });
          return null;
        });
      }

      const decision = resolveDeepLinkWorkspaceDecision(
        activeWorkspaceId,
        segments,
        memberWorkspaces,
      );

      if (decision.action === 'open') {
        setSwitchingToWorkspaceName(null);
        onWorkspaceReady();
        return;
      }

      if (decision.action === 'unavailable') {
        structuredLogger.warn('deep_link_workspace_switch_not_a_member', { segments });
        abandon();
        Alert.alert(
          'Message unavailable',
          'This message is in a workspace you do not have access to.',
        );
        return;
      }

      setSwitchingToWorkspaceName(decision.targetWorkspaceName ?? '');
      structuredLogger.info('deep_link_workspace_switch_started', {
        targetWorkspaceId: decision.targetWorkspaceId,
      });
      try {
        await switchWorkspace(decision.targetWorkspaceId);
      } catch (error: unknown) {
        structuredLogger.warn('deep_link_workspace_switch_failed', {
          targetWorkspaceId: decision.targetWorkspaceId,
          error,
        });
        abandon();
        Alert.alert('Could not open message', 'Switching to that workspace failed.');
        return;
      }
      // The overlay stays up until the caller reports the link opened: the new
      // session still has to rebuild before it has anything to show.
      onWorkspaceReady();
    },
    [abandon, onWorkspaceReady, switchWorkspace, token],
  );

  const claim = useCallback(
    (payload: DeepLinkScopePayload): boolean => {
      const segments = messageDeepLinkScopeSegments(payload);
      if (segments.length === 0) return false;

      // With no active workspace (cold cache) there is nothing to compare against, so
      // opening in place is the better guess than switching somewhere on a hunch.
      const activeWorkspaceId = getActiveWorkspaceId()?.trim();
      if (!activeWorkspaceId || segments.includes(activeWorkspaceId)) return false;

      const scopeKey = segments.join('/');
      if (claimedScopeRef.current === scopeKey) return true;
      claimedScopeRef.current = scopeKey;
      setSwitchingToWorkspaceName('');
      void resolveAndSwitch(segments, activeWorkspaceId);
      return true;
    },
    [resolveAndSwitch],
  );

  return { switchingToWorkspaceName, claim, complete, reset };
}
