import { ReactElement, ReactNode, useEffect, useRef } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { readSavedRoute } from '../../hooks/useSavedRoute';

// Bare /support restores the saved desk's list, never its last open ticket.
export const SupportListRestore = ({ children }: { children: ReactNode }): ReactElement => {
  const { pathname, search } = useLocation();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const isBare = /^\/[^/]+\/support\/?$/.test(pathname);
  const listPathRef = useRef(
    isBare && !search
      ? readSavedRoute(`support:${workspaceId}`)?.match(/^(\/[^/]+\/support\/[^/?#]+)\//)?.[1]
      : undefined,
  );

  useEffect(() => {
    if (!isBare) listPathRef.current = undefined;
  }, [isBare]);

  return listPathRef.current && isBare ? (
    <Navigate to={listPathRef.current} replace />
  ) : (
    <>{children}</>
  );
};
