import { useNavigate, useParams } from 'react-router-dom-actual';
import { useCallback } from 'react';
import type { NavigateFunction, NavigateOptions, To } from 'react-router-dom-actual';
import { prefixWorkspacePath } from '../lib/workspacePath';

/**
 * Drop-in replacement for `useNavigate` from react-router-dom.
 *
 * When called inside the `/:workspaceId/*` route context, absolute paths are
 * automatically prefixed with `/{workspaceId}` so every navigation keeps the
 * workspace segment in the URL.
 *
 * Numeric deltas (navigate(-1) / navigate(1)) and paths that already contain
 * the workspace prefix are forwarded unchanged.
 *
 * Usage – replace:
 *   import { useNavigate } from 'react-router-dom';
 * with:
 *   import { useNavigate } from '../hooks/useWorkspaceNavigate';
 */
export const useWorkspaceNavigate = (): NavigateFunction => {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();

  return useCallback(
    (to: To | number, options?: NavigateOptions): void => {
      if (typeof to === 'number') {
        void navigate(to);
        return;
      }

      void navigate(prefixWorkspacePath(to, workspaceId), options);
    },
    [navigate, workspaceId],
  ) as NavigateFunction;
};

// Re-export as `useNavigate` so files only need to change their import path.
export { useWorkspaceNavigate as useNavigate };
