import { useEffect, type ReactElement } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useParams } from 'react-router-dom-actual';

import { API_BASE_URL } from '../../config';
import { apiInstance } from '../../services/clients/apiClient';
import { queryClient } from '../../services/clients/queryClient';
import { useAuth } from '../../hooks/useAuth';
import { confirmInterrupt } from '../InterruptGuard/InterruptGuard';

/**
 * Keeps the authenticated session on the workspace the URL names.
 *
 * The app has carried two independent answers to "which workspace is active":
 * the URL (`useParams().workspaceId` — routing, sidebar, workspace switcher)
 * and the session (`user.workspaceId` — which is what `ZeroProvider` builds its
 * client from, and therefore what every piece of content comes from). Nothing
 * reconciled them, so any URL change that was not a full page load left the two
 * disagreeing: the switcher showed one workspace while the content came from
 * another, and the only way out was to switch away and back.
 *
 * Browser Back was the common way in. A cross-workspace link switches the
 * session and hard-reloads, so both agree; pressing Back is an SPA history pop,
 * which moves the URL and nothing else.
 *
 * This guard makes the URL authoritative and the session derived. It reuses the
 * app's existing switch path exactly — POST, clear the query cache, reload —
 * because every workspace switch in the app already hard-reloads
 * (`WorkspaceSwitcher.tsx`), so there is no in-place switching to preserve.
 */

/**
 * Records the workspace we last tried to switch INTO, surviving the reload.
 *
 * Without it this loops forever: reconcile → reload → the guard remounts with
 * fresh state → if the session still disagrees it reconciles again. `useRef`
 * cannot help, because the reload is the thing that resets it. Seeing our own
 * marker for the same target on a fresh load means the switch reported success
 * but did not take, so we stop rather than reload again.
 */
const ATTEMPT_KEY = 'xyne:workspaceSync:attempted';

/**
 * The session's workspace has to come from the server, not from `user`.
 *
 * On a normal browser load the auth machine rebuilds `user` out of localStorage
 * with `workspaceId: ''` hardcoded (`authMachine.ts:244-252`) — it is only
 * populated after a login or workspace-select flow. Comparing against it made
 * this guard silently no-op on exactly the reload it exists to catch.
 *
 * The cookie that does hold it, `xyne_last_workspace`, is `httpOnly`
 * (`authV2Middleware.ts:260`), so JS cannot read it either. `/auth/me` is the
 * only client-visible source of truth.
 *
 * Cached for the life of the page: the only thing that changes the session's
 * workspace is a switch, and every switch reloads, so this cannot go stale.
 */
let sessionWorkspacePromise: Promise<string | null> | null = null;

const getSessionWorkspaceId = async (): Promise<string | null> => {
  sessionWorkspacePromise ??= (async (): Promise<string | null> => {
    try {
      const response = await apiInstance.get('/auth/me');
      const data = response.data as { user?: { workspaceId?: string } } | undefined;
      return data?.user?.workspaceId || null;
    } catch {
      // Not authenticated, or the call failed. ProtectedRoute owns that case;
      // a guard that cannot read the session must not act on a guess.
      return null;
    }
  })();

  return sessionWorkspacePromise;
};

const readAttempt = (): string | null => {
  try {
    return window.sessionStorage.getItem(ATTEMPT_KEY);
  } catch {
    return null;
  }
};

const writeAttempt = (value: string | null): void => {
  try {
    if (value === null) window.sessionStorage.removeItem(ATTEMPT_KEY);
    else window.sessionStorage.setItem(ATTEMPT_KEY, value);
  } catch {
    // Private mode / storage disabled. The guard still works; it just loses the
    // loop brake, so fall through rather than blocking navigation entirely.
  }
};

export const WorkspaceSyncGuard = (): ReactElement | null => {
  const { workspaceId: routeWorkspaceId } = useParams<{ workspaceId?: string }>();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading || !isAuthenticated || !routeWorkspaceId) return;

    void (async (): Promise<void> => {
      const sessionWorkspaceId = await getSessionWorkspaceId();
      if (!sessionWorkspaceId) return;

      if (routeWorkspaceId === sessionWorkspaceId) {
        // In sync — release the brake so a later, legitimate switch can run.
        if (readAttempt() !== null) writeAttempt(null);
        return;
      }

      if (readAttempt() === routeWorkspaceId) {
        // Already tried this target and came back still mismatched. Reloading
        // again would loop, so surface it and leave the user somewhere coherent.
        writeAttempt(null);
        toast.error('Could not open that workspace.');
        window.location.href = `/${sessionWorkspaceId}`;
        return;
      }

      if (!(await confirmInterrupt('workspaceSwitch'))) {
        // Declined — send them back to the workspace their session is actually
        // on, so the URL stops claiming something that is not true.
        window.location.href = `/${sessionWorkspaceId}`;
        return;
      }

      writeAttempt(routeWorkspaceId);
      try {
        await axios.post(
          `${API_BASE_URL}/auth/switch-workspace`,
          { workspaceId: routeWorkspaceId },
          { withCredentials: true },
        );
      } catch (error) {
        writeAttempt(null);
        // 403 is terminal: the server resolves membership from the session's own
        // verified email, so retrying can never succeed.
        const isForbidden = axios.isAxiosError(error) && error.response?.status === 403;
        toast.error(
          isForbidden
            ? "You don't have access to that workspace."
            : 'Could not open that workspace.',
        );
        window.location.href = `/${sessionWorkspaceId}`;
        return;
      }

      queryClient.clear();
      // reload(), not an assignment: the URL is already the destination — it is
      // the session that has to catch up with it.
      window.location.reload();
    })();
  }, [routeWorkspaceId, isAuthenticated, isLoading]);

  return null;
};
