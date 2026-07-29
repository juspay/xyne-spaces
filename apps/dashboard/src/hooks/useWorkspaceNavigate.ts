import { useNavigate, useParams } from 'react-router-dom-actual';
import { useCallback } from 'react';
import type { NavigateFunction, NavigateOptions, To } from 'react-router-dom-actual';

/**
 * Paths that must NOT receive the workspace prefix.
 * These are top-level routes that live outside the /:workspaceId layout.
 */
const WORKSPACE_EXEMPT_PREFIXES = [
  '/auth',
  '/invite',
  '/launch',
  '/newWindow',
  '/redirected',
  '/call/',
  '/api/',
];

function normalizeSameOriginPath(to: string): string {
  if (typeof window === 'undefined' || !/^https?:\/\//i.test(to)) return to;
  try {
    const url = new URL(to);
    if (url.origin === window.location.origin) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return to;
  }
  return to;
}

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

      const normalizedTo = typeof to === 'string' ? normalizeSameOriginPath(to) : to;

      if (
        workspaceId &&
        typeof normalizedTo === 'string' &&
        normalizedTo.startsWith('/') &&
        !normalizedTo.startsWith(`/${workspaceId}`) &&
        !WORKSPACE_EXEMPT_PREFIXES.some(prefix => normalizedTo.startsWith(prefix))
      ) {
        void navigate(`/${workspaceId}${normalizedTo}`, options);
        return;
      }

      void navigate(normalizedTo, options);
    },
    [navigate, workspaceId],
  ) as NavigateFunction;
};

// Re-export as `useNavigate` so files only need to change their import path.
export { useWorkspaceNavigate as useNavigate };
