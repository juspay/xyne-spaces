import { ReactElement, ReactNode, useEffect, useMemo, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { readSavedRoute, setSavedRoute } from '../../hooks/useSavedRoute';

interface SaveRouteProps {
  /** Unique key under which this route's current URL is persisted. */
  keyword: string;
  /** Pathnames/queries to strip before persisting (ephemeral panels, etc.). */
  stripSearchParams?: readonly string[];
  children: ReactNode;
}

const buildPersistablePath = (
  pathname: string,
  search: string,
  stripSearchParams?: readonly string[],
): string => {
  if (!stripSearchParams?.length) return `${pathname}${search}`;
  const params = new URLSearchParams(search);
  for (const key of stripSearchParams) params.delete(key);
  const next = params.toString();
  return `${pathname}${next ? `?${next}` : ''}`;
};

export const SaveRoute = ({
  keyword,
  stripSearchParams,
  children,
}: SaveRouteProps): ReactElement => {
  const location = useLocation();

  const stripKey = useMemo(
    () => (stripSearchParams ? stripSearchParams.join('|') : ''),
    [stripSearchParams],
  );
  const stripRef = useRef(stripSearchParams);
  stripRef.current = stripSearchParams;

  const initialSavedRef = useRef<string | undefined>(readSavedRoute(keyword));
  const redirectAttemptedRef = useRef(false);

  let redirectTo: string | null = null;
  if (!redirectAttemptedRef.current) {
    redirectAttemptedRef.current = true;
    const saved = initialSavedRef.current;
    const current = `${location.pathname}${location.search}`;
    if (saved && saved !== current) {
      redirectTo = saved;
    }
  }

  useEffect(() => {
    setSavedRoute(
      keyword,
      buildPersistablePath(location.pathname, location.search, stripRef.current),
    );
  }, [keyword, location.pathname, location.search, stripKey]);

  if (redirectTo) {
    return <Navigate to={redirectTo} replace />;
  }
  return <>{children}</>;
};

export default SaveRoute;
