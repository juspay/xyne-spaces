import { ReactElement, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DocsViewer } from '../../components/DocsViewer';

const DocsScreen = (): ReactElement => {
  const location = useLocation();
  const navigate = useNavigate();

  const { repoName, branchName } = useMemo(() => {
    const pathParts = location.pathname.replace(/^\/docs\//, '').split('/');

    if (pathParts.length >= 3) {
      const org = pathParts[0];
      const repo = pathParts[1];
      const branch = pathParts.slice(2).join('/');
      return { repoName: `${org}/${repo}`, branchName: branch };
    }

    if (pathParts.length === 2) {
      const repo = pathParts[0];
      const branch = pathParts[1];
      return { repoName: repo, branchName: branch };
    }

    return { repoName: '', branchName: '' };
  }, [location.pathname]);

  // Handle going back
  const handleClose = (): void => {
    void navigate(-1);
  };

  if (!repoName || !branchName) {
    return (
      <div className='h-full relative bg-background md:rounded-2xl overflow-hidden shadow-md flex items-center justify-center'>
        <div className='text-center'>
          <h2 className='text-lg font-semibold text-foreground'>Documentation not found</h2>
          <p className='text-sm text-muted-foreground mt-2'>
            The requested documentation could not be found.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='h-full relative bg-background md:rounded-2xl overflow-hidden shadow-md'>
      <DocsViewer repoName={repoName} branchName={branchName} onClose={handleClose} />
    </div>
  );
};

export default DocsScreen;
