import { ReactElement, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';

/**
 * Redirects old chat routes to new directory-based routes
 *
 * Old format: /chat/{channelId}/...
 * New format: /chat/dir/{channelId}/...
 *
 * This component catches any routes that don't match the known paths
 * (dir, dm, bookmarks, canvas, activity, search) and redirects them to /chat/dir
 */
const DirectoryRedirect = (): ReactElement => {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();

  useEffect(() => {
    const catchAllPath = params['*'] || '';

    if (catchAllPath) {
      const newPath = `/chat/dir/${catchAllPath}`;
      const hash = location.hash;
      const search = location.search;

      void navigate(`${newPath}${search}${hash}`, { replace: true });
    }
  }, [navigate, params, location]);

  // Return null while redirecting
  return (
    <div className='flex items-center justify-center h-full text-gray-400'>Redirecting...</div>
  );
};

export default DirectoryRedirect;
