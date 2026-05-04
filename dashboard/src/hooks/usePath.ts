import { useLocation, useParams } from 'react-router-dom';

export const usePath = (): string => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const location = useLocation();
  const prefix = `/${workspaceId}`;
  return workspaceId && location.pathname.startsWith(prefix)
    ? location.pathname.slice(prefix.length)
    : location.pathname;
};
