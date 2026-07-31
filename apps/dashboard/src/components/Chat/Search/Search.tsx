import { ReactElement, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import ComposeDmPanel from '../AddDmForm/ComposeDmPanel';
import BrowseChannels from '../BrowseChannels/BrowseChannels';

const Search = (): ReactElement => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode');

  // route the user to create dm panenl if no mode
  useEffect(() => {
    if (!mode || (mode !== 'channels' && mode !== 'dm')) {
      void navigate('/chat/search?mode=dm', { replace: true });
    }
  }, [mode, navigate]);

  // For now, we only support 'channels' mode
  // Future modes could be added here (e.g., 'messages', 'users', etc.)
  if (mode === 'channels') {
    return <BrowseChannels />;
  }

  if (mode === 'dm') {
    // Key by the draft id (or navigation key) so re-opening a different draft from Drafts &
    // Sent remounts the panel and re-runs its restore effect.
    const composePanelKey =
      (location.state as { composePanelKey?: string } | null)?.composePanelKey ?? location.key;
    return <ComposeDmPanel key={composePanelKey} />;
  }

  // Default fallback - could be a search mode selector or default search view
  return (
    <div className='h-full flex flex-col items-center justify-center bg-background'>
      <div className='text-center'>
        <h2 className='text-lg font-semibold text-foreground mb-2'>Search</h2>
        <p className='text-muted-foreground'>Select a search mode to continue</p>
      </div>
    </div>
  );
};

export default Search;
